import assert from "node:assert/strict";
import test from "node:test";
import { combineShares, splitSecret } from "../src/shamir.js";

test("any two of three shares reconstruct the recovery secret", () => {
  const secret = crypto.getRandomValues(new Uint8Array(32));
  const shares = splitSecret(secret, { shares: 3, threshold: 2 });
  assert.deepEqual(combineShares([shares[0], shares[1]]), secret);
  assert.deepEqual(combineShares([shares[0], shares[2]]), secret);
  assert.deepEqual(combineShares([shares[1], shares[2]]), secret);
  assert.notDeepEqual(combineShares([shares[0], shares[0].map((value, index) => index ? value ^ 1 : 4)]), secret);
});

test("rejects duplicate and inconsistent shares", () => {
  const shares = splitSecret(new Uint8Array([1, 2, 3]), { shares: 3, threshold: 2 });
  assert.throws(() => combineShares([shares[0], shares[0]]), /duplicate/);
  assert.throws(() => combineShares([shares[0], shares[1].subarray(0, 2)]), /inconsistent/);
});
