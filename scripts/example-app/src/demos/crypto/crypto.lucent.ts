// Hashing, message authentication and authenticated encryption with each
// platform's own crypto: CryptoKit on iOS (Swift-only, called through
// generated shims), java.security and javax.crypto on Android.
import { PLATFORM } from "lucent:platform";
import {
  AES_GCM,
  AES_GCM_SealedBox,
  HMAC,
  SHA256,
  SymmetricKey,
  SymmetricKeySize,
} from "lucent:ios/CryptoKit";
import { MessageDigest } from "lucent:android/java.security";
import { Cipher, KeyGenerator, Mac } from "lucent:android/javax.crypto";
import { GCMParameterSpec, SecretKeySpec } from "lucent:android/javax.crypto.spec";
import { error, utf8Decode, utf8Encode } from "lucent:core";

export interface Sealed {
  /** The 256-bit key, in hex: new for every call. */
  key: string;
  nonce: string;
  /** The ciphertext followed by the 16-byte tag, in hex. */
  ciphertext: string;
  /** The ciphertext decrypted again with the same key. */
  opened: string;
}

const HEX = "0123456789abcdef";

function hex(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) out += HEX[b >> 4]! + HEX[b & 15]!;
  return out;
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

/** The SDK's answer, which is null only where the algorithm is missing. */
function need<T>(value: T | null, what: string): T {
  if (value === null) throw error("ERR_CRYPTO", `${what} is not available`);
  return value;
}

/** SHA-256 of the text's UTF-8 bytes, in hex. */
export async function sha256Async(text: string): Promise<string> {
  if (PLATFORM === "ios") {
    return hex(SHA256.hash(utf8Encode(text)).bytes);
  } else {
    const digest = need(MessageDigest.getInstance("SHA-256"), "SHA-256");
    return hex(need(digest.digest(utf8Encode(text)), "SHA-256"));
  }
}

/** HMAC-SHA256 of the text under the key (both UTF-8), in hex. */
export async function hmacSha256Async(key: string, text: string): Promise<string> {
  if (PLATFORM === "ios") {
    const mac = new HMAC<SHA256>(new SymmetricKey(utf8Encode(key)));
    mac.update(utf8Encode(text));
    return hex(mac.finalize().bytes);
  } else {
    const mac = need(Mac.getInstance("HmacSHA256"), "HmacSHA256");
    mac.init(new SecretKeySpec(utf8Encode(key), "HmacSHA256"));
    return hex(need(mac.doFinal(utf8Encode(text)), "HmacSHA256"));
  }
}

/** AES-256-GCM: seals the text under a new key, then opens it again. */
export async function sealAsync(text: string): Promise<Sealed> {
  if (PLATFORM === "ios") {
    const key = new SymmetricKey(SymmetricKeySize.bits256);
    const box = AES_GCM.seal(utf8Encode(text), key);
    const reopened = new AES_GCM_SealedBox(box.nonce, box.ciphertext, box.tag);

    return {
      key: hex(key.bytes),
      nonce: hex(box.nonce.bytes),
      ciphertext: hex(concat(box.ciphertext, box.tag)),
      opened: utf8Decode(AES_GCM.open(reopened, key)),
    };
  } else {
    const generator = need(KeyGenerator.getInstance("AES"), "AES");
    generator.init(256);
    const key = need(generator.generateKey(), "AES");

    const encrypt = need(Cipher.getInstance("AES/GCM/NoPadding"), "AES/GCM");
    encrypt.init(Cipher.ENCRYPT_MODE, key);
    const sealed = need(encrypt.doFinal(utf8Encode(text)), "AES/GCM");
    const nonce = need(encrypt.getIV(), "AES/GCM");

    const decrypt = need(Cipher.getInstance("AES/GCM/NoPadding"), "AES/GCM");
    decrypt.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(128, nonce));

    return {
      key: hex(key.getEncoded() ?? new Uint8Array(0)),
      nonce: hex(nonce),
      ciphertext: hex(sealed),
      opened: utf8Decode(need(decrypt.doFinal(sealed), "AES/GCM")),
    };
  }
}
