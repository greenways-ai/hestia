// Source-tree compatibility shim.
//
// In published browser artifacts, `../hara-runtime/index.js` resolves to the
// separately copied Hara runtime. Node-based source tests resolve this file
// instead, which re-exports the same pinned runtime from its repository path.
export * from "../vendor/hara/index.js";
