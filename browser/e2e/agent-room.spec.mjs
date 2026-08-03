import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

const browserRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
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
      response.end("<!doctype html><html><body><main>Hestia agent room test</main></body></html>");
      return;
    }

    const file = repositoryFile(url.pathname);
    if (!file || !file.startsWith(browserRoot)) {
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
  origin = "http://127.0.0.1:" + staticServer.address().port;
});

test.afterAll(async () => {
  await new Promise((resolveClose, reject) => staticServer.close(
    (error) => error ? reject(error) : resolveClose()
  ));
});

async function runRoomScenario(page) {
  await page.goto(origin + "/");
  return page.evaluate(async () => {
    const { createAgentRoomKernel } = await import("/hestia-browser/agent-room-kernel.js");
    const kernel = await createAgentRoomKernel();

    const profile = await kernel.dispatch("profile/register", {
      profile_id: "profile:host",
      profile_root: "sha256:profile-host",
      root_key: "key:host-root",
      operational_key: "key:host-operational-1",
      delegation_root: "sha256:host-delegation-1"
    });

    const room = await kernel.dispatch("room/create", {
      room_id: "room:alpha",
      policy_root: "sha256:room-policy",
      kernel_root: "sha256:agent-room-kernel",
      acceptance_mode: "human-required"
    });

    const invite = await kernel.dispatch("room/invite", {
      invite_id: "invite:external-agent",
      capability_commitment: "sha256:invite-capability",
      role: "negotiator",
      purposes: ["room.message", "negotiation.propose"],
      expires_at: "2026-08-05T00:00:00Z"
    });

    const admitted = await kernel.dispatch("room/admit", {
      invite_id: "invite:external-agent",
      member_id: "profile:external-agent",
      profile_root: "sha256:profile-external",
      operational_key: "key:external-room",
      delegation_root: "sha256:external-delegation",
      proof_verified: true,
      delegation_verified: true,
      invite_valid_verified: true
    });

    const attached = await kernel.dispatch("document/attach", {
      document_id: "document:terms",
      document_root: "sha256:document-terms-v1",
      policy_root: "sha256:document-policy",
      authority_verified: true
    });

    const message = await kernel.dispatch("message/send", {
      sender: "profile:external-agent",
      envelope_root: "sha256:message-envelope-1",
      ciphertext_root: "sha256:message-ciphertext-1",
      member_authorized: true
    });

    const proposed = await kernel.dispatch("negotiation/propose", {
      offer_id: "offer:1",
      offer_root: "sha256:offer-1",
      terms_root: "sha256:terms-1",
      proposed_by: "profile:external-agent",
      authority_root: "sha256:proposal-authority",
      member_authorized: true
    });

    const accepted = await kernel.dispatch("negotiation/accept", {
      offer_id: "offer:1",
      offer_root: "sha256:offer-1",
      accepted_by: "profile:host",
      acceptance_root: "sha256:acceptance-1",
      authority_verified: true,
      human_approval_verified: true
    });

    const rotated = await kernel.dispatch("profile/rotate-key", {
      operational_key: "key:host-operational-2",
      delegation_root: "sha256:host-delegation-2",
      authority_verified: true
    });

    const revoked = await kernel.dispatch("room/revoke", {
      member_id: "profile:external-agent",
      revocation_root: "sha256:external-revocation",
      authority_verified: true
    });

    return {
      profile,
      room,
      invite,
      admitted,
      attached,
      message,
      proposed,
      accepted,
      rotated,
      revoked
    };
  });
}

test("HAL owns agent profiles, private-room membership, and exact-root negotiation", async ({ page }) => {
  const result = await runRoomScenario(page);

  expect(result.profile.view.phase).toBe("profile-ready");
  expect(result.room.view.room_id).toBe("room:alpha");
  expect(result.room.view.member_count).toBe(1);
  expect(result.room.commands.map(({ capability }) => capability)).toEqual(["ledger", "crypto"]);
  expect(result.invite.commands.map(({ capability }) => capability)).toEqual(["ledger", "transport"]);
  expect(result.admitted.view.member_count).toBe(2);
  expect(result.admitted.view.membership_epoch).toBe(2);
  expect(result.admitted.commands.map(({ capability }) => capability)).toEqual([
    "ledger", "crypto", "transport"
  ]);
  expect(result.attached.view.document_count).toBe(1);
  expect(result.message.view.message_count).toBe(1);
  expect(result.proposed.view.offer_count).toBe(1);
  expect(result.accepted.view.accepted_offer).toBe("sha256:offer-1");
  expect(result.accepted.commands.map(({ capability }) => capability)).toEqual(["ledger", "transport"]);
  expect(result.rotated.view.membership_epoch).toBe(3);
  expect(result.revoked.view.membership_epoch).toBe(4);
});

test("an acceptance cannot bind a different offer root", async ({ page }) => {
  await page.goto(origin + "/");
  const error = await page.evaluate(async () => {
    const { createAgentRoomKernel } = await import("/hestia-browser/agent-room-kernel.js");
    const kernel = await createAgentRoomKernel();
    await kernel.dispatch("profile/register", {
      profile_id: "profile:host",
      profile_root: "sha256:profile-host",
      root_key: "key:host-root",
      operational_key: "key:host-operational",
      delegation_root: "sha256:host-delegation"
    });
    await kernel.dispatch("room/create", {
      room_id: "room:negotiation",
      policy_root: "sha256:room-policy",
      kernel_root: "sha256:agent-room-kernel"
    });
    await kernel.dispatch("negotiation/propose", {
      offer_id: "offer:bound",
      offer_root: "sha256:offer-canonical",
      terms_root: "sha256:terms-canonical",
      proposed_by: "profile:host",
      member_authorized: true
    });

    try {
      await kernel.dispatch("negotiation/accept", {
        offer_id: "offer:bound",
        offer_root: "sha256:offer-substituted",
        accepted_by: "profile:host",
        acceptance_root: "sha256:acceptance-invalid",
        authority_verified: true,
        human_approval_verified: true
      });
      return null;
    } catch (failure) {
      return String(failure?.message ?? failure);
    }
  });

  expect(error).toBeTruthy();
  expect(error).toMatch(/offer root|agent-room|evaluation/i);
});
