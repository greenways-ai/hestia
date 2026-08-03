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
    ".js": "text/javascript; charset=utf-8",
    ".hal": "text/plain; charset=utf-8",
    ".wasm": "application/wasm"
  }[extname(path)] ?? "application/octet-stream";
}

function resolveRequest(pathname) {
  if (pathname.startsWith("/hara-runtime/")) {
    return resolve(browserRoot, "vendor/hara", pathname.slice("/hara-runtime/".length));
  }
  if (pathname.startsWith("/ledger-hara/")) {
    return resolve(
      repositoryRoot,
      "gwdb-ledger-hal/src/gw/ledger",
      pathname.slice("/ledger-hara/".length)
    );
  }
  return null;
}

test.beforeAll(async () => {
  staticServer = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (url.pathname === "/runtime" || url.pathname === "/runtime/") {
      response.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        "referrer-policy": "no-referrer"
      });
      response.end("<!doctype html><meta charset=utf-8><title>Hestia ledger HAL test</title>");
      return;
    }
    const file = resolveRequest(url.pathname);
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

async function ledgerSession(page, name) {
  return page.evaluate(async ({ sessionName }) => {
    const { HtaContext } = await import("/hara-runtime/index.js");
    const context = new HtaContext({
      worker: new Worker("/hara-runtime/worker.js", { type: "module", name: sessionName }),
      moduleUrl: "/hara-runtime/hara_wasm_raw.wasm"
    });
    const resources = await Promise.all([
      ["gw.ledger.codec", "/ledger-hara/codec.hal"],
      ["gw.ledger.agent-room", "/ledger-hara/agent_room.hal"]
    ].map(async ([namespace, url]) => {
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) throw new Error(`unable to load ${namespace}`);
      return [namespace, await response.text()];
    }));
    await context.call("register-resources", [resources]);
    const session = await context.createSession(sessionName);
    await session.eval("(require [gw.ledger.agent-room :as room])");
    globalThis.__ledgerAgentSession = session;
    return true;
  }, { sessionName: name });
}

test("portable HAL frames native HCV1 agent records", async ({ page }) => {
  await page.goto(`${origin}/runtime/`);
  await ledgerSession(page, "LEDGER-AGENT-ROOM");
  const result = await page.evaluate(async () => {
    const session = globalThis.__ledgerAgentSession;
    const rootsArray = Array.from({ length: 8 }, (_, index) => String(index + 1).repeat(64));
    const roots = `[${rootsArray.map((root) => JSON.stringify(root)).join(" ")}]`;
    const payload = await session.eval(`(room/record-payload \"profile/version\" ${roots})`);
    const signing = await session.eval(`(room/signing-payload \"profile/version\" \"${"a".repeat(64)}\")`);
    const fields = await session.eval("(room/field-names \"negotiation/acceptance\")");
    return {
      payload,
      signing,
      fieldCount: fields.length,
      recordTypeTag: await session.eval("room/record-type-tag")
    };
  });

  expect(result.recordTypeTag).toBe(14);
  expect(result.payload).toMatch(/^R:hestia-agent\/1:profile\/version:1:8:/);
  expect(result.payload).toHaveLength("R:hestia-agent/1:profile/version:1:8:".length + 8 * 64);
  expect(result.signing).toBe(`GWAR1:profile/version:${"a".repeat(64)}`);
  expect(result.fieldCount).toBe(6);
});

test("portable HAL rejects a record with the wrong schema width", async ({ page }) => {
  await page.goto(`${origin}/runtime/`);
  await ledgerSession(page, "LEDGER-AGENT-REJECTION");
  const error = await page.evaluate(async () => {
    const session = globalThis.__ledgerAgentSession;
    try {
      await session.eval(`(room/record-payload \"profile/version\" [\"${"a".repeat(64)}\"])`);
      return null;
    } catch (failure) {
      return String(failure?.message ?? failure);
    }
  });

  expect(error).toBeTruthy();
  expect(error).toMatch(/field count mismatch|evaluation/i);
});
