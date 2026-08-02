import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const output = resolve(repository, ".pages");

if (dirname(output) !== repository || !output.endsWith("/.pages")) {
  throw new Error("refusing to build outside the repository .pages directory");
}

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await cp(resolve(repository, "browser/site"), output, { recursive: true });
await cp(resolve(repository, "browser/demo"), resolve(output, "recovery"), { recursive: true });
await cp(resolve(repository, "browser/src"), resolve(output, "hestia-browser"), { recursive: true });
await cp(resolve(repository, "browser/vendor/hara"), resolve(output, "hara-runtime"), { recursive: true });
await cp(resolve(repository, "browser/hara"), resolve(output, "hara"), { recursive: true });
await writeFile(resolve(output, ".nojekyll"), "");
await writeFile(resolve(output, "CNAME"), "hestia-demo.greenways.ai\n");

console.log(`GitHub Pages artifact built at ${output}`);
