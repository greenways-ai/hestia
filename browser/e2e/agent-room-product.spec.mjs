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
  if (pathname === "/rooms" || pathname === "/rooms/") {
    return resolve(browserRoot, "rooms/index.html");
  }
  if (pathname.startsWith("/rooms/")) {
    return resolve(browserRoot, "rooms", pathname.slice("/rooms/".length));
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

test("creates, uses, and resumes a cryptographically signed private agent room", async ({ page }) => {
  test.setTimeout(90_000);
  page.on("pageerror", (error) => console.error("agent room page error:", error));
  page.on("console", (message) => {
    if (message.type() === "error") console.error("agent room console:", message.text());
  });

  await page.goto(`${origin}/rooms/`);
  await expect(page.locator("#statusLabel")).toHaveText("Workspace verified", { timeout: 30_000 });

  await page.getByRole("button", { name: "Create signed profile" }).click();
  await expect(page.locator("#profileState")).toHaveText("Active", { timeout: 30_000 });
  await expect(page.locator("#profileFingerprint")).toContainText("ed25519:");

  await page.getByRole("button", { name: "Open private room" }).click();
  await expect(page.locator("#roomState")).toHaveText("Open");
  await expect(page.locator("#epochState")).toHaveText("1");
  const roomId = await page.locator("#roomIdentifier").textContent();
  expect(roomId).toMatch(/^room:/);

  await page.getByRole("button", { name: "Issue signed invite" }).click();
  await expect(page.locator("#inviteValue")).toHaveValue(/^#v=1&invite=/);

  await page.getByRole("button", { name: "Verify and admit agent" }).click();
  await expect(page.locator("#memberState")).toHaveText("2", { timeout: 30_000 });
  await expect(page.locator("#epochState")).toHaveText("2");
  await expect(page.locator("#guestStatus")).toContainText("Verified");

  await page.getByRole("button", { name: "Sign and attach document" }).click();
  await expect(page.locator("#documentResult")).toBeVisible();
  await expect(page.locator("#documentResult code")).toContainText("sha256:");

  await page.getByRole("button", { name: "Encrypt, sign and send" }).click();
  await expect(page.locator("#messageResult")).toBeVisible();
  await expect(page.locator("#messageResult")).toContainText("reviewed the brief");

  await page.getByRole("button", { name: "Propose signed offer" }).click();
  await expect(page.locator("#offerSheet")).toContainText("AUD 300");
  await expect(page.locator("#offerSheet")).toContainText("sha256:");

  await page.getByRole("button", { name: "Human approve and accept exact root" }).click();
  await expect(page.locator("#acceptanceResult")).toBeVisible();
  await expect(page.locator("#acceptanceResult")).toContainText("Accepted the exact offer root");
  await expect(page.locator("#recordCount")).toHaveText("8 records");

  await page.reload();
  await expect(page.locator("#statusLabel")).toHaveText("Workspace resumed", { timeout: 30_000 });
  await expect(page.locator("#profileState")).toHaveText("Active");
  await expect(page.locator("#roomIdentifier")).toHaveText(roomId ?? "");
  await expect(page.locator("#memberState")).toHaveText("2");
  await expect(page.locator("#epochState")).toHaveText("2");
  await expect(page.locator("#acceptanceResult")).toBeVisible();
});
