import assert from "node:assert/strict";
import test from "node:test";
import {
  createDocumentRoomInvite,
  documentRoomOwnerSessionKey,
  parseDocumentRoomInvite
} from "../src/document-room-invite.js";

function deterministicRandom() {
  let next = 0;
  return {
    getRandomValues(bytes) {
      for (let index = 0; index < bytes.length; index += 1) bytes[index] = next++ % 256;
      return bytes;
    }
  };
}

test("document room capability remains in the URL fragment", () => {
  const invite = createDocumentRoomInvite("https://hestia.example/rooms/", {
    random: deterministicRandom()
  });
  assert.equal(invite.url.pathname, "/documents/room/");
  assert.equal(invite.url.search, "");
  assert.match(invite.url.hash, /cap=/);
  const parsed = parseDocumentRoomInvite(invite.url);
  assert.equal(parsed.room, invite.room);
  assert.deepEqual([...parsed.capabilityBytes], [...invite.capabilityBytes]);
  assert.equal(documentRoomOwnerSessionKey(invite.room), `hestia-document-room-owner:${invite.room}`);
});

test("rejects document capabilities in query strings", () => {
  assert.throws(
    () => parseDocumentRoomInvite("https://hestia.example/documents/room/?cap=leak"),
    /fragment/
  );
});
