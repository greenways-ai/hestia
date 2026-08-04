import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { createSignalingServer } from "../../services/signaling/src/server.mjs";

const browserRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(browserRoot, "..");
const artworkRoot = resolve(repositoryRoot, "site/public/assets");
const activeContexts = new Set();
let signal;
let staticServer;
let origin;
let signalEndpoint;

test.describe.configure({ mode: "serial" });

function contentType(path) {
  return {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".hal": "text/plain; charset=utf-8",
    ".wasm": "application/wasm",
    ".webp": "image/webp",
    ".jpg": "image/jpeg",
    ".svg": "image/svg+xml"
  }[extname(path)] ?? "application/octet-stream";
}

function resolveRequest(requestPathname) {
  const pathname = requestPathname.startsWith("/hestia/")
    ? requestPathname.slice("/hestia".length)
    : requestPathname;
  if (pathname === "/recovery/lab/" || pathname === "/recovery/lab") {
    return resolve(browserRoot, "lab/index.html");
  }
  if (pathname.startsWith("/recovery/lab/")) {
    return resolve(browserRoot, "lab", pathname.slice("/recovery/lab/".length));
  }
  if (pathname === "/recovery/" || pathname === "/recovery"
      || pathname === "/recovery-demo/" || pathname === "/recovery-demo") {
    return resolve(browserRoot, "demo/index.html");
  }
  if (pathname.startsWith("/recovery-demo/")) {
    return resolve(browserRoot, "demo", pathname.slice("/recovery-demo/".length));
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
  if (pathname.startsWith("/assets/")) {
    return resolve(artworkRoot, pathname.slice("/assets/".length));
  }
  return null;
}

test.beforeAll(async () => {
  signal = createSignalingServer({ port: 0 });
  await signal.listen();
  signalEndpoint = "ws://127.0.0.1:" + signal.address().port + "/signal";

  staticServer = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const file = resolveRequest(url.pathname);
    if (!file || (!file.startsWith(browserRoot) && !file.startsWith(artworkRoot))) {
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

test.afterEach(async () => {
  const contexts = [...activeContexts];
  activeContexts.clear();
  await Promise.all(contexts.map((context) => context.close().catch(() => undefined)));
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
  activeContexts.add(firstContext);
  activeContexts.add(secondContext);
  await firstContext.addInitScript((endpoint) => {
    globalThis.HESTIA_SIGNAL_URL = endpoint;
  }, signalEndpoint);
  await secondContext.addInitScript((endpoint) => {
    globalThis.HESTIA_SIGNAL_URL = endpoint;
  }, signalEndpoint);
  return { firstContext, secondContext };
}

async function waitForLabMarker(page, marker, label, timeout = 30_000) {
  await page.waitForFunction(
    ({ markerName }) => Boolean(globalThis[markerName] || globalThis.__HESTIA_LAB_ERROR__),
    { markerName: marker },
    { timeout }
  );
  const state = await page.evaluate(() => ({
    error: globalThis.__HESTIA_LAB_ERROR__ ?? null,
    status: document.getElementById("statusLabel")?.textContent ?? null,
    detail: document.getElementById("statusDetail")?.textContent ?? null
  }));
  if (state.error) throw new Error(`${label}: ${state.error} (${state.detail ?? "no detail"})`);
  return state;
}

async function waitForLabStatus(page, expected, label, timeout = 30_000) {
  await page.waitForFunction(
    ({ expectedStatus }) => document.getElementById("statusLabel")?.textContent === expectedStatus
      || Boolean(globalThis.__HESTIA_LAB_ERROR__),
    { expectedStatus: expected },
    { timeout }
  );
  const state = await page.evaluate(() => ({
    error: globalThis.__HESTIA_LAB_ERROR__ ?? null,
    status: document.getElementById("statusLabel")?.textContent ?? null,
    detail: document.getElementById("statusDetail")?.textContent ?? null
  }));
  if (state.error) throw new Error(`${label}: ${state.error} (${state.detail ?? "no detail"})`);
  expect(state.status, `${label} status detail: ${state.detail}`).toBe(expected);
}

async function waitForContinuity(page, timeout = 35_000) {
  await page.waitForFunction(
    () => Boolean(globalThis.__HESTIA_CONTINUITY_READY__ || globalThis.__HESTIA_CONTINUITY_ERROR__),
    undefined,
    { timeout }
  );
  const state = await page.evaluate(() => ({
    ready: Boolean(globalThis.__HESTIA_CONTINUITY_READY__),
    error: globalThis.__HESTIA_CONTINUITY_ERROR__ ?? null,
    status: document.getElementById("kernelState")?.textContent ?? null,
    detail: document.getElementById("kernelDetail")?.textContent ?? null
  }));
  if (state.error) throw new Error(`Continuity kernel failed: ${state.error} (${state.detail ?? "no detail"})`);
  expect(state.ready).toBe(true);
}

function attachDiagnostics(name, page) {
  page.on("pageerror", (error) => console.error(`${name} page error: ${error?.stack ?? error}`));
  page.on("console", (message) => {
    if (message.type() === "error") console.error(`${name} console: ${message.text()}`);
  });
}

async function pairAndRecover(browser, mode) {
  test.setTimeout(90_000);
  const pair = await contexts(browser);
  const first = await pair.firstContext.newPage();
  const second = await pair.secondContext.newPage();
  attachDiagnostics("first", first);
  attachDiagnostics("second", second);

  await first.goto(origin + "/recovery/lab/");
  await waitForLabMarker(first, "__HESTIA_LAB_IDLE_READY__", "first browser idle startup");
  await first.locator("#mode").selectOption(mode);
  const createInvite = first.getByRole("button", { name: "Create private invite" });
  await expect(createInvite).toBeEnabled();
  await createInvite.click();
  await expect(first).toHaveURL(/#v=2&ceremony=/, { timeout: 20_000 });
  await waitForLabMarker(first, "__HESTIA_LAB_CEREMONY_STARTED__", "first browser ceremony startup");
  const invite = first.url();

  await second.goto(invite);
  await waitForLabMarker(second, "__HESTIA_LAB_CEREMONY_STARTED__", "second browser ceremony startup");
  await Promise.all([
    waitForLabStatus(first, "Ready", "first browser pairing", 35_000),
    waitForLabStatus(second, "Ready", "second browser pairing", 35_000)
  ]);

  const requestRecovery = first.getByRole("button", { name: "Request recovery" });
  await expect(requestRecovery).toBeEnabled({ timeout: 20_000 });
  await requestRecovery.click();
  await expect(second.locator("#approvalPanel")).toBeVisible({ timeout: 20_000 });
  const approve = second.getByRole("button", { name: "Approve" });
  await expect(approve).toBeEnabled({ timeout: 20_000 });
  await approve.click();
  await waitForLabStatus(first, "Recovery complete", "requesting browser recovery", 40_000);
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

test("continuity presents a luxury private-office arrangement and starts under the production base path", async ({ page }) => {
  attachDiagnostics("continuity", page);
  await page.goto(origin + "/hestia/recovery-demo/");
  await waitForContinuity(page);

  await expect(page.getByRole("heading", { name: "Continuity, before you need it." })).toBeVisible();
  await expect(page.locator(".principle-grid article")).toHaveCount(3);
  await expect(page.getByText(/Mabel|wombat/i)).toHaveCount(0);
  await expect(page.locator("#halProgramName")).toHaveText("hestia.workflow-v3");
  await expect(page.locator("#halProgramVersion")).toHaveText("0.4.0");
  await expect(page.locator("#halEventCount")).toHaveText("15");
  await expect(page.locator("#halSource")).toContainText("(defn program-info");
  await expect(page.locator("#halSource")).toContainText("Private Office Continuity");

  const hero = page.locator(".continuity-hero__art img");
  await expect(hero).toBeVisible();
  expect(await hero.evaluate((image) => image.complete && image.naturalWidth > 0)).toBe(true);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(hero).toBeVisible();
  await expect(hero).toHaveCSS("object-fit", "cover");
});

test("legacy v1 invite recovers to v2 ceremony creation", async ({ page }) => {
  await page.goto(origin + "/recovery/lab/#v=1&ceremony=EkrNjvfMxQ1d47GsvePTDA&cap=3DGUDZ7eZdaCR8mS55Wt0nY71-3drcM6EZtyQVUhckg&mode=reusable");
  await expect(page.locator("#statusLabel")).toHaveText("Invite expired");
  await expect(page.locator("#invitePanel")).toBeVisible();
  await expect(page).not.toHaveURL(/#v=1/);
  await page.getByRole("button", { name: "Create private invite" }).click();
  await expect(page).toHaveURL(/#v=2&ceremony=/);
});

test("guided continuity flow protects, restores, and proves a private office", async ({ page }) => {
  test.setTimeout(70_000);
  attachDiagnostics("guided continuity", page);
  await page.goto(origin + "/hestia/recovery-demo/");
  await waitForContinuity(page);

  await page.getByRole("button", { name: "Choose continuity stewards" }).click();
  await expect(page.locator(".authority-option")).toHaveCount(6);
  await page.locator(".authority-option").nth(0).click();
  await page.locator(".authority-option").nth(2).click();
  await page.locator(".authority-option").nth(4).click();
  await page.getByRole("button", { name: "Review the arrangement" }).click();
  await page.getByRole("button", { name: "Seal the continuity plan" }).click();
  await expect(page.getByRole("heading", { name: "Your continuity plan is sealed" })).toBeVisible({ timeout: 25_000 });
  await expect(page.getByText("2-of-3 stewardship arranged")).toBeVisible();

  const secrets = page.locator(".secrets-accordion");
  await expect(secrets).not.toHaveAttribute("open", "");
  await secrets.getByText("Show continuity material", { exact: true }).click();
  await expect(secrets).toHaveAttribute("open", "");
  await expect(secrets.getByText("Hide continuity material", { exact: true })).toBeVisible();
  await expect(secrets.locator(".share-grid .secret-card")).toHaveCount(3);
  await secrets.getByText("Hide continuity material", { exact: true }).click();
  await expect(secrets).not.toHaveAttribute("open", "");

  await page.getByRole("button", { name: "Simulate an unavailable office key" }).click();
  await expect(page.getByRole("heading", { name: "The office key is unavailable" })).toBeVisible();
  await page.getByRole("button", { name: "Ask the stewards" }).click();
  await page.locator(".authority").nth(0).click();
  await page.locator(".authority").nth(1).click();
  await page.getByRole("button", { name: "Restore the private office" }).click();
  await expect(page.getByRole("heading", { name: "The private office is restored" })).toBeVisible({ timeout: 35_000 });

  await page.getByRole("button", { name: "Sign a continuity proof" }).click();
  await expect(page.locator("#chatBadge")).toHaveText("Verified office");
  await page.locator("#technical > summary").click();
  await page.getByText("Show demonstration cryptographic values", { exact: true }).click();
  await expect(page.getByText("Private office key", { exact: true })).toBeVisible();
  await expect(page.locator(".raw-values strong").filter({ hasText: "Owner-held continuity factor" })).toBeVisible();
  await expect(page.locator(".raw-values .share-grid .secret-card")).toHaveCount(3);

  await page.getByRole("button", { name: "Back" }).click();
  await expect(page.getByRole("heading", { name: "Two stewards approved continuity" })).toBeVisible();
  await page.getByRole("button", { name: "Return to the restored office" }).click();
  await expect(page.getByRole("heading", { name: "The private office is restored" })).toBeVisible();
  await page.getByRole("button", { name: "Restart" }).click();
  await waitForContinuity(page);
  await expect(page.getByRole("heading", { name: "Name the office you are protecting" })).toBeVisible({ timeout: 25_000 });
});

test("reusable peers sharing one URL recover and reconnect", async ({ browser }) => {
  const state = await pairAndRecover(browser, "reusable");
  await state.first.close();
  await state.second.close();
  await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  const first = await state.firstContext.newPage();
  const second = await state.secondContext.newPage();
  attachDiagnostics("reconnected first", first);
  attachDiagnostics("reconnected second", second);
  await Promise.all([first.goto(state.invite), second.goto(state.invite)]);
  await Promise.all([
    waitForLabStatus(first, "Ready", "reconnected first browser", 35_000),
    waitForLabStatus(second, "Ready", "reconnected second browser", 35_000)
  ]);
});

test("single-use peers erase both shares after recovery", async ({ browser }) => {
  const state = await pairAndRecover(browser, "single");
  await state.first.close();
  await state.second.close();
  await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  const first = await state.firstContext.newPage();
  const second = await state.secondContext.newPage();
  attachDiagnostics("consumed first", first);
  attachDiagnostics("consumed second", second);
  await Promise.all([first.goto(state.invite), second.goto(state.invite)]);
  await Promise.all([
    waitForLabMarker(first, "__HESTIA_LAB_CEREMONY_STARTED__", "consumed first browser"),
    waitForLabMarker(second, "__HESTIA_LAB_CEREMONY_STARTED__", "consumed second browser")
  ]);
  await expect(first.getByRole("button", { name: "Request recovery" })).toBeDisabled();
  await expect(second.getByRole("button", { name: "Request recovery" })).toBeDisabled();
});
