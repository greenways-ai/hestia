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
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".wasm": "application/wasm"
  }[extname(path)] ?? "application/octet-stream";
}

function resolveRequest(pathname) {
  if (pathname === "/recovery" || pathname === "/recovery/") {
    return resolve(browserRoot, "demo/index.html");
  }
  if (pathname.startsWith("/recovery/")) {
    return resolve(browserRoot, "demo", pathname.slice("/recovery/".length));
  }
  if (pathname.startsWith("/hestia-browser/")) {
    return resolve(browserRoot, "src", pathname.slice("/hestia-browser/".length));
  }
  if (pathname.startsWith("/hara-runtime/")) {
    return resolve(browserRoot, "vendor/hara", pathname.slice("/hara-runtime/".length));
  }
  if (pathname.startsWith("/hara/")) {
    return resolve(browserRoot, "hara", pathname.slice("/hara/".length));
  }
  return null;
}

test.beforeAll(async () => {
  staticServer = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const file = resolveRequest(url.pathname);
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
  origin = `http://127.0.0.1:${staticServer.address().port}`;
});

test.afterAll(async () => {
  await new Promise((resolveClose, reject) => staticServer.close(
    (error) => error ? reject(error) : resolveClose()
  ));
});

test("concurrent ceremony events commit atomically in invocation order", async ({ page }) => {
  await page.goto(`${origin}/recovery/`);
  const result = await page.evaluate(async () => {
    const { createCeremonyKernel } = await import("/hestia-browser/ceremony-kernel.js");
    const kernel = await createCeremonyKernel();
    const joinedPromise = kernel.dispatch("ceremony/join", { mode: "single" });
    const connectedPromise = kernel.dispatch("transport/connected");
    const [joined, connected] = await Promise.all([joinedPromise, connectedPromise]);
    return { joined, connected, finalView: await kernel.view() };
  });

  expect(result.joined.state.phase).toBe("pairing");
  expect(result.connected.state.phase).toBe("connected");
  expect(result.connected.state.connected).toBe(true);
  expect(result.connected.state.mode).toBe("single");
  expect(result.finalView.status_label).toBe("Connected");
});

test("concurrent profile and room events cannot observe the same stale state", async ({ page }) => {
  await page.goto(`${origin}/recovery/`);
  const result = await page.evaluate(async () => {
    const { createAgentRoomKernel } = await import("/hestia-browser/agent-room-kernel.js");
    const kernel = await createAgentRoomKernel();
    const profilePromise = kernel.dispatch("profile/register", {
      profile_id: "profile:queue-host",
      profile_root: "sha256:profile-queue-host",
      root_key: "ed25519:root",
      operational_key: "ed25519:operational",
      delegation_root: "sha256:delegation"
    });
    const roomPromise = kernel.dispatch("room/create", {
      room_id: "room:queue-test",
      policy_root: "sha256:policy",
      kernel_root: "sha256:kernel",
      acceptance_mode: "human-required"
    });
    const [profile, room] = await Promise.all([profilePromise, roomPromise]);
    return { profile, room, finalView: await kernel.view() };
  });

  expect(result.profile.state.phase).toBe("profile-ready");
  expect(result.room.state.phase).toBe("open");
  expect(result.finalView.room_id).toBe("room:queue-test");
  expect(result.finalView.member_count).toBe(1);
  expect(result.finalView.membership_epoch).toBe(1);
});
