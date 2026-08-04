import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../../migrations/20260804042000_agent_room_message_intent_status.sql",
  import.meta.url
);

test("immutable message intents remain pending until a separate delivery receipt", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  assert.match(sql, /CHECK \(delivery_status = 'pending-delivery'\)/);
  assert.match(sql, /Delivery and failure are later signed receipt events/);
  assert.doesNotMatch(sql, /delivery_status IN \('pending-delivery', 'delivered', 'failed'\)/);
});
