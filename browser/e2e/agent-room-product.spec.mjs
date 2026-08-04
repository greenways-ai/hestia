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
  if (pathname === "/rooms" || pathname === "/rooms/") {
    return resolve(browserRoot, "rooms/index.html");
  }
  if (pathname.startsWith("/rooms/")) {
    return resolve(browserRoot, "rooms", pathname.slice("/rooms/".length));
  }
  if (pathname === "/recovery-demo" || pathname === "/recovery-demo/") {
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
    return resolve(repositoryRoot, "site/public/assets", pathname.slice("/assets/".length));
  }
  return null;
}

test.beforeAll(async () => {
  staticServer = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const file = resolveRequest(url.pathname);
    if (!file || (!file.startsWith(browserRoot) && !file.startsWith(repositoryRoot))) {
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

async function waitForOffice(page) {
  await page.waitForFunction(
    () => Boolean(globalThis.__HESTIA_AGENT_OFFICE_READY__ || globalThis.__HESTIA_AGENT_OFFICE_ERROR__),
    undefined,
    { timeout: 35_000 }
  );
  const state = await page.evaluate(() => ({
    ready: Boolean(globalThis.__HESTIA_AGENT_OFFICE_READY__),
    error: globalThis.__HESTIA_AGENT_OFFICE_ERROR__ ?? null,
    status: document.getElementById("statusLabel")?.textContent ?? null,
    detail: document.getElementById("statusDetail")?.textContent ?? null
  }));
  if (state.error) throw new Error(`Agent Office failed: ${state.error} (${state.detail ?? "no detail"})`);
  expect(state.ready).toBe(true);
}

test("runs, receipts, closes, and resumes a complete HAL private agent office under the production base path", async ({ page }) => {
  test.setTimeout(120_000);
  page.on("pageerror", (error) => console.error("agent office page error:", error));
  page.on("console", (message) => {
    if (message.type() === "error") console.error("agent office console:", message.text());
  });

  await page.goto(`${origin}/hestia/rooms/`);
  await waitForOffice(page);

  await expect(page.getByRole("heading", { name: "A private office for everything your agents do." })).toBeVisible();
  await expect(page.locator("#halProgramName")).toHaveText("hestia.agent-room");
  await expect(page.locator("#halProgramVersion")).toHaveText("0.2.0");
  await expect(page.locator("#halEventCount")).toHaveText("16");
  await expect(page.locator(".office-hero__day")).toBeVisible();
  expect(await page.locator(".office-hero__day").evaluate((image) => image.complete && image.naturalWidth > 0)).toBe(true);

  await page.getByRole("button", { name: "Run the complete HAL office" }).click();
  await expect(page.locator("#statusLabel")).toHaveText("Office closed with a complete record", { timeout: 90_000 });

  await expect(page.locator("#recordCount")).toHaveText("16 records");
  await expect(page.locator("#roomState")).toHaveText("Closed");
  await expect(page.locator("#guestStatus")).toHaveText("Access ended");
  await expect(page.locator("#mandateState")).toHaveText("1");
  await expect(page.locator("#workState")).toHaveText("1");
  await expect(page.locator("#receiptState")).toHaveText("1");
  await expect(page.locator("#receiptStatus")).toHaveText("Prepared for sharing");
  await expect(page.locator("#receiptRoot")).toContainText("sha256:");
  await expect(page.locator("#latestReceipt")).toContainText("sha256:");
  await expect(page.locator("#receiptAudienceValue")).toHaveText("Client or trusted adviser");

  const halSource = page.locator("#halSource");
  await expect(halSource).toContainText("(defn create-mandate");
  await expect(halSource).toContainText("(defn record-work");
  await expect(halSource).toContainText("(defn share-receipt");
  await expect(halSource).toContainText("(defn close-room");
  await expect(page.locator("#halActiveEvent")).toHaveText("room/close");

  const roomId = await page.locator("#roomIdentifier").textContent();
  expect(roomId).toMatch(/^room:/);

  await page.reload();
  await waitForOffice(page);
  await expect(page.locator("#statusLabel")).toHaveText("Private office resumed", { timeout: 35_000 });
  await expect(page.locator("#roomIdentifier")).toHaveText(roomId ?? "");
  await expect(page.locator("#recordCount")).toHaveText("16 records");
  await expect(page.locator("#receiptStatus")).toHaveText("Prepared for sharing");
  await expect(page.locator("#roomState")).toHaveText("Closed");
});
