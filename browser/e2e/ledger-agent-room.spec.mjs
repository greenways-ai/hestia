import { expect, test } from "@playwright/test";

const basePath = process.env.HESTIA_BASE_PATH || "/hestia/";
const origin = `http://127.0.0.1:4173${basePath}`;

async function ledgerSession(page, name) {
  await page.waitForFunction(() => Boolean(globalThis.haraRuntime?.ready));
  return page.evaluate(async ({ sessionName }) => {
    const runtime = globalThis.haraRuntime;
    const session = await runtime.session({ name: sessionName });
    await session.eval("(require [gw.ledger.agent-room :as room])");
    globalThis.__ledgerAgentSession = session;
    return true;
  }, { sessionName: name });
}

test("portable HAL frames native HCV0 agent records", async ({ page }) => {
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
  expect(result.payload).toMatch(/^R:hestia-agent\/0-alpha:profile\/version:1:8:/);
  expect(result.payload).toHaveLength("R:hestia-agent/0-alpha:profile/version:1:8:".length + 8 * 64);
  expect(result.signing).toBe(`GWAR0:profile/version:${"a".repeat(64)}`);
  expect(result.fieldCount).toBe(5);
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
  expect(error).toContain("record field count mismatch");
});
