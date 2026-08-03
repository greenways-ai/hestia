import {
  createPrivateKey,
  createPublicKey,
  sign as signDetached,
  verify as verifyDetached
} from "node:crypto";
import { readFile } from "node:fs/promises";

function decodeBase64Url(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error("invalid Ed25519 public-key encoding");
  }
  const padded = value.replaceAll("-", "+").replaceAll("_", "/")
    + "=".repeat((4 - value.length % 4) % 4);
  return Buffer.from(padded, "base64");
}

function encodeBase64Url(value) {
  return Buffer.from(value).toString("base64url");
}

export function createEnvironmentSigner(privateKeyPem) {
  const privateKey = createPrivateKey(privateKeyPem);
  if (privateKey.asymmetricKeyType !== "ed25519") {
    throw new Error("Hestia environment signing key must be Ed25519");
  }
  const publicKey = createPublicKey(privateKey);
  const jwk = publicKey.export({ format: "jwk" });
  if (jwk.kty !== "OKP" || jwk.crv !== "Ed25519" || !jwk.x) {
    throw new Error("unable to derive an Ed25519 environment public key");
  }
  const publicKeyBytes = decodeBase64Url(jwk.x);
  if (publicKeyBytes.length !== 32) {
    throw new Error("Hestia environment public key must be 32 bytes");
  }

  return Object.freeze({
    publicKey,
    publicKeyBytes,
    publicKeyBase64Url: encodeBase64Url(publicKeyBytes),
    sign(payload) {
      const signature = signDetached(null, Buffer.from(payload), privateKey);
      if (signature.length !== 64) {
        throw new Error("Hestia environment signature must be 64 bytes");
      }
      return signature;
    },
    verify(payload, signature) {
      return verifyDetached(
        null,
        Buffer.from(payload),
        publicKey,
        Buffer.from(signature)
      );
    }
  });
}

export async function loadEnvironmentSigner(path) {
  if (!path) throw new Error("HESTIA_ENVIRONMENT_SIGNING_KEY_FILE is required");
  return createEnvironmentSigner(await readFile(path));
}
