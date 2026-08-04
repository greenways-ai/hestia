import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const output = resolve(repository, ".pages");
const ledgerOutput = resolve(output, "hara-ledger");

if (dirname(output) !== repository || !output.endsWith("/.pages")) {
  throw new Error("refusing to build outside the repository .pages directory");
}

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await cp(resolve(repository, "browser/site"), output, { recursive: true });
await cp(resolve(repository, "site/public/assets"), resolve(output, "assets"), { recursive: true });
await cp(resolve(repository, "browser/demo"), resolve(output, "recovery"), { recursive: true });
await cp(resolve(repository, "browser/lab"), resolve(output, "recovery/lab"), { recursive: true });
await cp(resolve(repository, "browser/rooms"), resolve(output, "rooms"), { recursive: true });
await cp(resolve(repository, "browser/documents"), resolve(output, "documents"), { recursive: true });
await cp(resolve(repository, "browser/src"), resolve(output, "hestia-browser"), { recursive: true });
await cp(resolve(repository, "browser/vendor/hara"), resolve(output, "hara-runtime"), { recursive: true });
await cp(resolve(repository, "browser/hara"), resolve(output, "hara"), { recursive: true });
await mkdir(ledgerOutput, { recursive: true });
await cp(
  resolve(repository, "gwdb-ledger-hal/src/gw/ledger/document_protocol.hal"),
  resolve(ledgerOutput, "document_protocol.hal")
);
await cp(
  resolve(repository, "gwdb-ledger-hal/src/gw/ledger/document_ot.hal"),
  resolve(ledgerOutput, "document_ot.hal")
);
await writeFile(resolve(output, ".nojekyll"), "");
await writeFile(resolve(output, "CNAME"), "hestia-demo.greenways.ai\n");

console.log(`GitHub Pages artifact built at ${output}`);
