function multiply(left, right) {
  let a = left;
  let b = right;
  let result = 0;
  while (b) {
    if (b & 1) result ^= a;
    const high = a & 0x80;
    a = (a << 1) & 0xff;
    if (high) a ^= 0x1b;
    b >>>= 1;
  }
  return result;
}

function power(value, exponent) {
  let result = 1;
  let base = value;
  let remaining = exponent;
  while (remaining > 0) {
    if (remaining & 1) result = multiply(result, base);
    base = multiply(base, base);
    remaining >>>= 1;
  }
  return result;
}

function inverse(value) {
  if (value === 0) throw new Error("cannot invert zero in GF(256)");
  return power(value, 254);
}

export function splitSecret(secret, {
  shares = 3,
  threshold = 2,
  random = globalThis.crypto
} = {}) {
  const bytes = secret instanceof Uint8Array ? secret : new Uint8Array(secret);
  if (bytes.length === 0) throw new Error("secret must not be empty");
  if (!Number.isInteger(threshold) || threshold < 2 || threshold > 255) throw new Error("invalid threshold");
  if (!Number.isInteger(shares) || shares < threshold || shares > 255) throw new Error("invalid share count");
  if (!random?.getRandomValues) throw new Error("cryptographic random source required");

  const output = Array.from({ length: shares }, (_, index) => {
    const share = new Uint8Array(bytes.length + 1);
    share[0] = index + 1;
    return share;
  });
  const coefficients = new Uint8Array(threshold - 1);

  for (let offset = 0; offset < bytes.length; offset += 1) {
    random.getRandomValues(coefficients);
    for (const share of output) {
      const x = share[0];
      let y = bytes[offset];
      let xPower = 1;
      for (const coefficient of coefficients) {
        xPower = multiply(xPower, x);
        y ^= multiply(coefficient, xPower);
      }
      share[offset + 1] = y;
    }
  }
  coefficients.fill(0);
  return output;
}

export function combineShares(input) {
  if (!Array.isArray(input) || input.length < 2) throw new Error("at least two shares required");
  const shares = input.map((value) => value instanceof Uint8Array ? value : new Uint8Array(value));
  const length = shares[0].length;
  if (length < 2 || shares.some((share) => share.length !== length)) throw new Error("inconsistent shares");
  const indexes = shares.map((share) => share[0]);
  if (indexes.some((index) => index === 0) || new Set(indexes).size !== indexes.length) {
    throw new Error("invalid or duplicate share indexes");
  }

  const secret = new Uint8Array(length - 1);
  for (let offset = 1; offset < length; offset += 1) {
    let value = 0;
    for (let i = 0; i < shares.length; i += 1) {
      let basis = 1;
      for (let j = 0; j < shares.length; j += 1) {
        if (i === j) continue;
        basis = multiply(basis, multiply(indexes[j], inverse(indexes[i] ^ indexes[j])));
      }
      value ^= multiply(shares[i][offset], basis);
    }
    secret[offset - 1] = value;
  }
  return secret;
}
