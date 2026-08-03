import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("agent profile, room, and negotiation policy are defined in Hara", async () => {
  const adapter = await readFile(new URL("../src/agent-room-kernel.js", import.meta.url), "utf8");
  const runtime = await readFile(new URL("../src/hara.js", import.meta.url), "utf8");
  const hara = await readFile(new URL("../hara/agent_room.hal", import.meta.url), "utf8");

  assert.match(runtime, /hestia\.agent-room/);
  assert.match(adapter, /room\/advance/);
  assert.doesNotMatch(adapter, /room\/member-admitted|negotiation\/offer-accepted|membership_epoch/);
  assert.match(hara, /defn register-profile/);
  assert.match(hara, /defn admit-member/);
  assert.match(hara, /defn accept-offer/);
  assert.match(hara, /acceptance must bind the exact offer root/);
  assert.match(hara, /rotate-room-epoch/);
  assert.match(hara, /"capability"/);
});
