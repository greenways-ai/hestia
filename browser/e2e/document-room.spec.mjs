import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

const browserRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(browserRoot, "..");
let staticServer;
let origin;

function contentType(path) {
  return {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".hal": "text/plain; charset=utf-8",
    ".wasm": "application/wasm"
  }[extname(path)] ?? "application/octet-stream";
}

function repositoryFile(pathname) {
  if (pathname.startsWith("/hestia-browser/")) {
    return resolve(browserRoot, "src", pathname.slice("/hestia-browser/".length));
  }
  if (pathname.startsWith("/hara-runtime/")) {
    return resolve(browserRoot, "vendor/hara", pathname.slice("/hara-runtime/".length));
  }
  if (pathname.startsWith("/hara/")) {
    return resolve(browserRoot, "hara", pathname.slice("/hara/".length));
  }
  if (pathname.startsWith("/hara-ledger/")) {
    return resolve(
      repositoryRoot,
      "gwdb-ledger-hal/src/gw/ledger",
      pathname.slice("/hara-ledger/".length)
    );
  }
  if (pathname.startsWith("/protocol/")) {
    return resolve(repositoryRoot, "protocol", pathname.slice("/protocol/".length));
  }
  return undefined;
}

test.beforeAll(async () => {
  staticServer = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (url.pathname === "/") {
      response.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store"
      });
      response.end("<!doctype html><html><body><main>Hestia document room test</main></body></html>");
      return;
    }
    const file = repositoryFile(url.pathname);
    if (!file || !file.startsWith(repositoryRoot)) {
      response.writeHead(404).end();
      return;
    }
    try {
      const body = await readFile(file);
      response.writeHead(200, {
        "content-type": contentType(file),
        "cache-control": "no-store",
        "referrer-policy": "no-referrer"
      });
      response.end(body);
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise((resolveListen) => staticServer.listen(0, "127.0.0.1", resolveListen));
  origin = `http://127.0.0.1:${staticServer.address().port}`;
});

test.afterAll(async () => {
  await new Promise((resolveClose, reject) => staticServer.close(
    (error) => error ? reject(error) : resolveClose()
  ));
});

test("two real Hara kernels converge on a stale signed batch", async ({ page }) => {
  await page.goto(`${origin}/`);
  const result = await page.evaluate(async () => {
    const { createAgentProfile, generateAgentKey } = await import(
      "/hestia-browser/agent-protocol.js"
    );
    const { createDocumentRoomKernel } = await import(
      "/hestia-browser/document-room-kernel.js"
    );
    const { DocumentRoom } = await import(
      "/hestia-browser/document-room-api.js"
    );

    const document = {
      profile: "greenways.rich-text/2",
      id: "document:kernel-webrtc-test",
      revision: 0,
      children: [{
        id: "paragraph:kernel",
        type: "paragraph",
        attrs: {},
        children: [{
          id: "text:kernel",
          type: "text",
          text: "Hello world",
          marks: []
        }]
      }]
    };

    async function createMember(id, role) {
      const [rootKey, documentKey] = await Promise.all([
        generateAgentKey(),
        generateAgentKey()
      ]);
      const profile = await createAgentProfile({
        profileId: id,
        name: id,
        rootKey,
        operationalKey: documentKey,
        purposes: ["profile.update", "document.edit"],
        validUntil: "2099-01-01T00:00:00.000Z"
      });
      return {
        documentKey,
        descriptor: {
          memberId: id,
          label: id,
          role,
          publicKeyJwk: documentKey.publicJwk,
          profileRecord: profile.record,
          delegationRecord: profile.delegation
        }
      };
    }

    const [hostMember, guestMember, hostKernel, guestKernel] = await Promise.all([
      createMember("profile:kernel-host", "sequencer"),
      createMember("profile:kernel-guest", "editor"),
      createDocumentRoomKernel({
        role: "sequencer",
        roomId: "room:kernel-test",
        documentId: document.id
      }),
      createDocumentRoomKernel({
        role: "participant",
        roomId: "room:kernel-test",
        documentId: document.id
      })
    ]);

    const host = new DocumentRoom({
      role: "sequencer",
      roomId: "room:kernel-test",
      document,
      kernel: hostKernel,
      documentKey: hostMember.documentKey,
      localMember: hostMember.descriptor
    });
    const guest = new DocumentRoom({
      role: "participant",
      roomId: "room:kernel-test",
      document,
      kernel: guestKernel,
      documentKey: guestMember.documentKey,
      localMember: guestMember.descriptor
    });
    host.addMember(guestMember.descriptor);
    guest.addMember(hostMember.descriptor);
    const genesis = await host.issueGenesis();
    await guest.acceptGenesis(genesis);

    const firstBatch = await host.createBatch([{
      id: "operation:kernel-bright",
      type: "text.splice",
      targetId: "text:kernel",
      offset: 0,
      deleteCount: 0,
      insert: "Bright "
    }]);
    const firstCommit = await host.sequenceBatch(
      firstBatch,
      hostMember.descriptor.memberId
    );
    await guest.applyCommit(firstCommit);

    const secondBatch = await guest.createBatch([{
      id: "operation:kernel-hara",
      type: "text.splice",
      targetId: "text:kernel",
      offset: 6,
      deleteCount: 5,
      insert: "Hara"
    }], {
      baseRevision: 0,
      baseDocument: guest.snapshots.get(0)
    });
    const secondCommit = await host.sequenceBatch(
      secondBatch,
      guestMember.descriptor.memberId
    );
    await guest.applyCommit(secondCommit);

    const readText = (room) => room.document.children[0].children[0].text;
    return {
      hostText: readText(host),
      guestText: readText(guest),
      hostRevision: host.revision,
      guestRevision: guest.revision,
      sameHead: host.headRoot === guest.headRoot,
      transformedOffset: secondCommit.transformedOperations[0].offset,
      receiptRoot: secondCommit.receipt.record.root,
      hostKernelView: await hostKernel.view(),
      guestKernelView: await guestKernel.view()
    };
  });

  expect(result.hostText).toBe("Bright Hello Hara");
  expect(result.guestText).toBe("Bright Hello Hara");
  expect(result.hostRevision).toBe(2);
  expect(result.guestRevision).toBe(2);
  expect(result.sameHead).toBe(true);
  expect(result.transformedOffset).toBe(13);
  expect(result.receiptRoot).toMatch(/^sha256:[0-9a-f]{64}$/);
  expect(result.hostKernelView.role).toBe("sequencer");
  expect(result.guestKernelView.role).toBe("participant");
});
