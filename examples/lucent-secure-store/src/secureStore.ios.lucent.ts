// expo-secure-store's SecureStoreModule.swift: generic passwords in the Keychain.
import { kSecAttrAccount, kSecAttrService, kSecClass, kSecClassGenericPassword, kSecMatchLimit, kSecMatchLimitOne, kSecReturnData, kSecValueData, SecItemAdd, SecItemCopyMatching, SecItemDelete, SecItemUpdate } from "lucent:ios/Security";
import { asData, type NSObject, type ObjCValue, Out } from "lucent:ios";
import { error, utf8Decode, utf8Encode } from "@lucent-lang/core";

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

export async function setItemAsync(key: string, value: string): Promise<void> {
  const add = query(key);
  add[kSecValueData] = utf8Encode(value);
  const status = SecItemAdd(add, null);
  if (status !== errSecDuplicateItem) return check(status, "SecItemAdd");
  const update: Record<string, ObjCValue> = {};
  update[kSecValueData] = utf8Encode(value);
  check(SecItemUpdate(query(key), update), "SecItemUpdate");
}

export async function getItemAsync(key: string): Promise<string | null> {
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

export async function deleteItemAsync(key: string): Promise<void> {
  const status = SecItemDelete(query(key));
  if (status !== errSecItemNotFound) check(status, "SecItemDelete");
}
