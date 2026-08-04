import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = () => readFile(
  new URL("../../gwdb-ledger-hal/src/gw/ledger/document_ot.hal", import.meta.url),
  "utf8"
);

test("portable ledger module stays in the gw namespace and defines signed records", async () => {
  const value = await source();
  assert.match(value, /^\(ns gw\.ledger\.document-ot/m);
  for (const kind of [
    "document/text-splice",
    "document/artefact-commit",
    "document/batch",
    "document/transformation",
    "document/revision",
    "document/import-receipt"
  ]) {
    assert.ok(value.includes(`\"${kind}\"`), `missing ${kind}`);
  }
});

test("portable ledger module explicitly imports every non-core OT function", async () => {
  const value = await source();
  assert.match(
    value,
    /\[std\.foundation :refer \[assoc conj get max min reduce\]\]/
  );
  for (const symbol of ["assoc", "conj", "get", "max", "min", "reduce"]) {
    assert.ok(value.includes(symbol), `missing explicit ${symbol} import`);
  }
});

test("portable ledger module owns the deterministic OT path", async () => {
  const value = await source();
  for (const fn of [
    "map-position",
    "transform-text-splice",
    "transform-artefact-commit",
    "transform-operation",
    "transform-batch",
    "admission-valid?"
  ]) {
    assert.ok(value.includes(`(defn ${fn}`), `missing ${fn}`);
  }
});
