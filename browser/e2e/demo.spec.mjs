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
    ".js": "text/javascript; charset=utf-8",
    ".webp": "image/webp"
  }[extname(path)] ?? "application/octet-stream";
}

test.beforeAll(async () => {
  signal = createSignalingServer({ port: 0 });
  await signal.listen();
  signalEndpoint = "ws://127.0.0.1:" + signal.address().port + "/signal";

  staticServer = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    let file;
    if (url.pathname === "/recovery/lab/" || url.pathname === "/recovery/lab") {
      file = resolve(browserRoot, "lab/index.html");
    } else if (url.pathname.startsWith("/recovery/lab/")) {
      file = resolve(browserRoot, "lab", url.pathname.slice("/recovery/lab/".length));
    } else if (url.pathname === "/recovery/" || url.pathname === "/recovery") {
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
  await first.goto(origin + "/recovery/lab/");
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
  // Firefox CI cold-starts the pinned WASM worker after approval.
  await expect(first.locator("#statusLabel")).toHaveText("Recovery complete", { timeout: 30_000 });
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

test("Hara/WASM owns ceremony transitions, commands, and views", async ({ page }) => {
  await page.goto(origin + "/recovery/");
  const result = await page.evaluate(async () => {
    const { createCeremonyKernel } = await import("/hestia-browser/ceremony-kernel.js");
    const kernel = await createCeremonyKernel();
    const joined = await kernel.dispatch("ceremony/join", { mode: "single" });
    const connected = await kernel.dispatch("transport/connected");
    return { joined, connected };
  });
  expect(result.joined.state.phase).toBe("pairing");
  expect(result.joined.view.status_label).toBe("Waiting for peer");
  expect(result.joined.commands.map(({ capability }) => capability)).toEqual([
    "persistence", "transport"
  ]);
  expect(result.connected.state.connected).toBe(true);
  expect(result.connected.view.status_label).toBe("Connected");
});

test("guided demo presents the recovery mechanism as a wombat story", async ({ page }) => {
  await page.goto(origin + "/recovery/");
  await expect(page.getByText("Demo", { exact: true })).toBeVisible();
  await expect(page.locator(".story-step")).toHaveCount(5);
  await expect(page.getByText("Advanced lab", { exact: true })).toHaveCount(0);
  await expect(page.getByText(/Custodia communis/)).toHaveCount(0);
  await expect(page.getByText(/Claves tuae|Colloquium privatum|guardian/i)).toHaveCount(0);
  const explanation = page.locator(".story-step").first().locator(".help-popover p");
  await expect(explanation).not.toBeVisible();
  await page.locator(".story-step").first().locator("summary[aria-label='About identity creation']").click();
  await expect(explanation).toBeVisible();
  await expect(page.locator(".story-art").first()).toBeVisible();
  await expect(page.locator(".story-art")).toHaveCount(5);
  expect(await page.locator(".story-art").evaluateAll((images) => images.every((image) => image.complete && image.naturalWidth > 0))).toBe(true);
  await expect(page.locator(".story-art").first()).toHaveAttribute("alt", /Mabel.*wombat/i);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(".story-art").first()).toBeVisible();
  await expect(page.locator(".story-art").first()).toHaveCSS("object-fit", "cover");
});

test("legacy v1 invite recovers to v2 ceremony creation", async ({ page }) => {
  await page.goto(origin + "/recovery/lab/#v=1&ceremony=EkrNjvfMxQ1d47GsvePTDA&cap=3DGUDZ7eZdaCR8mS55Wt0nY71-3drcM6EZtyQVUhckg&mode=reusable");
  await expect(page.locator("#statusLabel")).toHaveText("Invite expired");
  await expect(page.locator("#invitePanel")).toBeVisible();
  await expect(page).not.toHaveURL(/#v=1/);
  await page.getByRole("button", { name: "Create private invite" }).click();
  await expect(page).toHaveURL(/#v=2&ceremony=/);
});

test("guided v3 flow explains, recovers, and uses an identity", async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto(origin + "/recovery/");
  await page.getByRole("button", { name: "Choose recovery helpers" }).click();
  await expect(page.locator(".authority-option")).toHaveCount(6);
  await page.locator(".authority-option").nth(0).click();
  await page.locator(".authority-option").nth(2).click();
  await page.locator(".authority-option").nth(4).click();
  await page.getByRole("button", { name: "Review protection" }).click();
  await page.getByRole("button", { name: "Create demo identity" }).click();
  await expect(page.getByRole("heading", { name: "Mabel's identity is protected" })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("2-of-3 protection configured")).toBeVisible();
  await page.getByRole("button", { name: "Simulate lost access" }).click();
  await expect(page.getByRole("heading", { name: "Mabel has lost access" })).toBeVisible();
  await page.getByRole("button", { name: "Ask the helpers" }).click();
  await page.locator(".authority").nth(0).click();
  await page.locator(".authority").nth(1).click();
  await page.getByRole("button", { name: "Restore identity" }).click();
  await expect(page.getByRole("heading", { name: "Mabel's identity is restored" })).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Send a signed demo message" }).click();
  await expect(page.locator("#chatBadge")).toHaveText("Verified identity");
  await page.locator("#technical > summary").click();
  await page.getByText("Show demo cryptographic values", { exact: true }).click();
  await expect(page.getByText("Private identity key", { exact: true })).toBeVisible();
  await expect(page.locator(".raw-values strong").filter({ hasText: "Device-secured factor" })).toBeVisible();
  await expect(page.locator(".share-grid .secret-card")).toHaveCount(3);
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
