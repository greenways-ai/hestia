import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { createSignalingServer } from "../../services/signaling/src/server.mjs";

const browserRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
let signal;
let staticServer;
let origin;
let signalEndpoint;

function contentType(path) {
  return {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8"
  }[extname(path)] ?? "application/octet-stream";
}

test.beforeAll(async () => {
  signal = createSignalingServer({ port: 0 });
  await signal.listen();
  signalEndpoint = "ws://127.0.0.1:" + signal.address().port + "/signal";

  staticServer = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    let file;
    if (url.pathname === "/recovery/" || url.pathname === "/recovery") {
      file = resolve(browserRoot, "demo/index.html");
    } else if (url.pathname.startsWith("/recovery/")) {
      file = resolve(browserRoot, "demo", url.pathname.slice("/recovery/".length));
    } else if (url.pathname.startsWith("/hestia-browser/")) {
      file = resolve(browserRoot, "src", url.pathname.slice("/hestia-browser/".length));
    } else if (url.pathname.startsWith("/hara-runtime/")) {
      file = resolve(browserRoot, "vendor/hara", url.pathname.slice("/hara-runtime/".length));
    } else if (url.pathname.startsWith("/hara/")) {
      file = resolve(browserRoot, "hara", url.pathname.slice("/hara/".length));
    }
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
  await signal.close();
  await new Promise((resolveClose, reject) => staticServer.close(
    (error) => error ? reject(error) : resolveClose()
  ));
});

async function contexts(browser) {
  const firstContext = await browser.newContext();
  const secondContext = await browser.newContext();
  await firstContext.addInitScript((endpoint) => {
    globalThis.HESTIA_SIGNAL_URL = endpoint;
  }, signalEndpoint);
  await secondContext.addInitScript((endpoint) => {
    globalThis.HESTIA_SIGNAL_URL = endpoint;
  }, signalEndpoint);
  return { firstContext, secondContext };
}

async function pairAndRecover(browser, mode) {
  const pair = await contexts(browser);
  let first = await pair.firstContext.newPage();
  let second = await pair.secondContext.newPage();
  for (const [name, page] of [["first", first], ["second", second]]) {
    page.on("pageerror", (error) => console.error(`${name} page error:`, error));
    page.on("console", (message) => {
      if (message.type() === "error") console.error(`${name} console:`, message.text());
    });
  }
  await first.goto(origin + "/recovery/");
  await first.locator("#mode").selectOption(mode);
  await first.getByRole("button", { name: "Create private invite" }).click();
  await expect(first).toHaveURL(/#v=2&ceremony=/);
  const invite = first.url();
  await second.goto(invite);

  await expect(first.locator("#statusLabel")).toHaveText("Ready", { timeout: 20_000 });
  await expect(second.locator("#statusLabel")).toHaveText("Ready", { timeout: 20_000 });
  await first.getByRole("button", { name: "Request recovery" }).click();
  await expect(second.locator("#approvalPanel")).toBeVisible();
  await second.getByRole("button", { name: "Approve" }).click();
  await expect(first.locator("#statusLabel")).toHaveText("Recovery complete", { timeout: 10_000 });
  await expect(first.locator("#result")).toHaveText("Identity proof verified");
  return { ...pair, first, second, invite };
}

test("Hara/WASM owns threshold split and reconstruction", async ({ page }) => {
  await page.goto(origin + "/recovery/");
  const result = await page.evaluate(async () => {
    const { splitSecret, combineShares, haraRuntimeInfo } = await import("/hestia-browser/shamir.js");
    const secret = new Uint8Array([3, 1, 4, 1, 5, 9]);
    const shares = await splitSecret(secret, { shares: 3, threshold: 2 });
    const restored = await combineShares([shares[0], shares[2]]);
    return { restored: [...restored], info: await haraRuntimeInfo() };
  });
  expect(result.restored).toEqual([3, 1, 4, 1, 5, 9]);
  expect(result.info).toBeTruthy();
});

test("reusable peers sharing one URL recover and reconnect", async ({ browser }) => {
  const state = await pairAndRecover(browser, "reusable");
  await state.first.close();
  await state.second.close();
  await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  const first = await state.firstContext.newPage();
  const second = await state.secondContext.newPage();
  await Promise.all([first.goto(state.invite), second.goto(state.invite)]);
  await expect(first.locator("#statusLabel")).toHaveText("Ready", { timeout: 20_000 });
  await expect(second.locator("#statusLabel")).toHaveText("Ready", { timeout: 20_000 });
  await state.firstContext.close();
  await state.secondContext.close();
});

test("single-use peers erase both shares after recovery", async ({ browser }) => {
  const state = await pairAndRecover(browser, "single");
  await state.first.close();
  await state.second.close();
  await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  const first = await state.firstContext.newPage();
  const second = await state.secondContext.newPage();
  await Promise.all([first.goto(state.invite), second.goto(state.invite)]);
  await expect(first.getByRole("button", { name: "Request recovery" })).toBeDisabled();
  await expect(second.getByRole("button", { name: "Request recovery" })).toBeDisabled();
  await state.firstContext.close();
  await state.secondContext.close();
});
