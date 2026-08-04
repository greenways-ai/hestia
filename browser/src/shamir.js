import { haraSession, requireWebCrypto } from "./hara.js";

let runtimePromise;

async function loadRuntime() {
  return { session: await haraSession("HESTIA-CRYPTO", "[std.crypto.shamir :as shamir]") };
}

function runtime() {
  runtimePromise ??= loadRuntime().catch((error) => {
    runtimePromise = undefined;
    throw error;
  });
  return runtimePromise;
}

export async function splitSecret(secret, { shares = 3, threshold = 2 } = {}) {
  const bytes = secret instanceof Uint8Array ? secret : new Uint8Array(secret);
  const { session } = await runtime();
  const entropyLength = await session.evalBound(
    "(shamir/entropy-byte-count __hta_arg_0 __hta_arg_1 __hta_arg_2)",
    [bytes, shares, threshold]
  );
  const coefficients = requireWebCrypto().getRandomValues(new Uint8Array(entropyLength));
  return session.evalBound(
    "(shamir/split-with-coefficients __hta_arg_0 __hta_arg_1 __hta_arg_2 __hta_arg_3)",
    [bytes, shares, threshold, coefficients]
  );
}

export async function combineShares(shares) {
  const values = shares.map((share) => share instanceof Uint8Array ? share : new Uint8Array(share));
  const { session } = await runtime();
  return session.evalBound("(shamir/combine __hta_arg_0)", [values]);
}

export async function haraRuntimeInfo() {
  const { session } = await runtime();
  return session.info();
}
