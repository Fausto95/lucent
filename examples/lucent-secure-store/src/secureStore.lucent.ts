// expo-secure-store's API, implemented in Lucent per platform (M2.1 parity
// port): SecureStoreModule.swift's generic passwords in the Keychain, and
// SecureStoreModule.kt's values encrypted with an AES/GCM key from the
// Android Keystore, stored in SharedPreferences.
import { PLATFORM } from "lucent:platform";
import { kSecAttrAccount, kSecAttrService, kSecClass, kSecClassGenericPassword, kSecMatchLimit, kSecMatchLimitOne, kSecReturnData, kSecValueData, SecItemAdd, SecItemCopyMatching, SecItemDelete, SecItemUpdate } from "lucent:ios/Security";
import { asData, type NSObject, type ObjCValue, Out } from "lucent:ios";
import { SharedPreferences } from "lucent:android/android.content";
import { KeyGenParameterSpec_Builder, KeyProperties } from "lucent:android/android.security.keystore";
import { Base64 } from "lucent:android/android.util";
import { KeyStore, KeyStore_SecretKeyEntry, type Key } from "lucent:android/java.security";
import { Cipher, KeyGenerator } from "lucent:android/javax.crypto";
import { GCMParameterSpec } from "lucent:android/javax.crypto.spec";
import { appContext } from "lucent:android";
import { error, utf8Decode, utf8Encode } from "@lucent-lang/core";

// --- iOS ---------------------------------------------------------------------

const errSecDuplicateItem = -25299;
const errSecItemNotFound = -25300;

function query(key: string): Record<string, ObjCValue> {
  const q: Record<string, ObjCValue> = {};
  q[kSecClass] = kSecClassGenericPassword;
  q[kSecAttrService] = "app";
  q[kSecAttrAccount] = utf8Encode(key);
  return q;
}

function check(status: number, what: string): void {
  if (status !== 0) throw error("ERR_SECURESTORE", `${what} failed with OSStatus ${status}`);
}

function keychainSet(key: string, value: string): void {
  const add = query(key);
  add[kSecValueData] = utf8Encode(value);
  const status = SecItemAdd(add, null);
  if (status !== errSecDuplicateItem) return check(status, "SecItemAdd");
  const update: Record<string, ObjCValue> = {};
  update[kSecValueData] = utf8Encode(value);
  check(SecItemUpdate(query(key), update), "SecItemUpdate");
}

function keychainGet(key: string): string | null {
  const q = query(key);
  q[kSecReturnData] = true;
  q[kSecMatchLimit] = kSecMatchLimitOne;
  const result = new Out<NSObject>();
  const status = SecItemCopyMatching(q, result);
  if (status === errSecItemNotFound) return null;
  check(status, "SecItemCopyMatching");
  const data = asData(result.value);
  return data ? utf8Decode(data) : null;
}

// --- Android -----------------------------------------------------------------

const ALIAS = "lucent-secure-store";

function prefs(): SharedPreferences {
  const p = appContext().getSharedPreferences("SecureStore", 0);
  if (!p) throw error("ERR_SECURESTORE", "No SharedPreferences");
  return p;
}

function secretKey(): Key {
  const store = KeyStore.getInstance("AndroidKeyStore");
  store?.load(null);
  const entry = store?.getEntry(ALIAS, null);
  if (entry) return (entry as KeyStore_SecretKeyEntry).getSecretKey()!;
  const generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
  const spec = new KeyGenParameterSpec_Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
    .setBlockModes([KeyProperties.BLOCK_MODE_GCM])
    ?.setEncryptionPaddings([KeyProperties.ENCRYPTION_PADDING_NONE])
    ?.build();
  if (!generator || !spec) throw error("ERR_SECURESTORE", "Could not create the encryption key");
  generator.init(spec);
  return generator.generateKey()!;
}

function encryptedSet(name: string, value: string): void {
  const cipher = Cipher.getInstance("AES/GCM/NoPadding");
  if (!cipher) throw error("ERR_SECURESTORE", "No AES/GCM cipher");
  cipher.init(Cipher.ENCRYPT_MODE, secretKey());
  const encrypted = cipher.doFinal(utf8Encode(value)) ?? new Uint8Array(0);
  const iv = cipher.getIV() ?? new Uint8Array(0);
  const stored = `${Base64.encodeToString(iv, Base64.NO_WRAP)}:${Base64.encodeToString(encrypted, Base64.NO_WRAP)}`;
  if (!prefs().edit()?.putString(name, stored)?.commit()) throw error("ERR_SECURESTORE", "Could not save the value");
}

function encryptedGet(name: string): string | null {
  const stored = prefs().getString(name, null);
  if (!stored) return null;
  const [iv, encrypted] = stored.split(":");
  const cipher = Cipher.getInstance("AES/GCM/NoPadding");
  if (!cipher || iv === undefined || encrypted === undefined) throw error("ERR_SECURESTORE", "Unreadable stored value");
  cipher.init(Cipher.DECRYPT_MODE, secretKey(), new GCMParameterSpec(128, Base64.decode(iv, Base64.NO_WRAP)));
  const plain = cipher.doFinal(Base64.decode(encrypted, Base64.NO_WRAP));
  return plain ? utf8Decode(plain) : null;
}

// --- The module --------------------------------------------------------------

export async function setItemAsync(key: string, value: string): Promise<void> {
  if (PLATFORM === "ios") keychainSet(key, value);
  else encryptedSet(key, value);
}

export async function getItemAsync(key: string): Promise<string | null> {
  return PLATFORM === "ios" ? keychainGet(key) : encryptedGet(key);
}

export async function deleteItemAsync(key: string): Promise<void> {
  if (PLATFORM === "ios") {
    const status = SecItemDelete(query(key));
    if (status !== errSecItemNotFound) check(status, "SecItemDelete");
  } else {
    prefs().edit()?.remove(key)?.commit();
  }
}
