// A key-value store on the platform's own preferences: a UserDefaults
// suite on iOS, a private SharedPreferences file on Android. Values are
// strings, numbers or booleans; index.ts stores other values as JSON text.
// Each write notifies the listeners `watch` registers, in this process.
import { error, subscribe } from "lucent:core";
import { PLATFORM } from "lucent:platform";
import { UserDefaults } from "lucent:ios/Foundation";
import { appContext } from "lucent:android";
import { Context, type SharedPreferences } from "lucent:android/android.content";

export type Value = string | number | boolean;

export type Change = { store: string; key: string; removed: boolean };

const listeners = new Map<number, (change: Change) => void>();
let nextListener = 0;

function changed(store: string, key: string, removed: boolean): void {
  for (const listener of listeners.values()) listener({ store, key, removed });
}

/** The platform's name for a store: its UserDefaults suite or SharedPreferences file. */
function domain(store: string): string {
  if (!/^[\w.-]{1,64}$/.test(store))
    throw error(
      "E_STORE_NAME",
      `"${store}" is not a store name: use letters, digits, ".", "-" or "_"`,
    );
  return `lucent.kv.${store}`;
}

// --- iOS: UserDefaults -------------------------------------------------------

const suites = new Map<string, UserDefaults>();

function suite(store: string): UserDefaults {
  const found = suites.get(store);
  if (found) return found;
  const made = new UserDefaults(domain(store));
  suites.set(store, made);
  return made;
}

/** The suite's own keys: its dictionaryRepresentation also holds the global domain's. */
function suiteKeys(store: string): string[] {
  return Object.keys(suite(store).persistentDomain(domain(store)) ?? {});
}

// --- Android: SharedPreferences ----------------------------------------------

// Numbers are kept as their text, which reads back exactly: SharedPreferences has no double.
const NUMBER = "#";

function prefs(store: string): SharedPreferences {
  const p = appContext().getSharedPreferences(domain(store), Context.MODE_PRIVATE);
  if (!p) throw error("E_STORE_OPEN", `SharedPreferences ${store} is not available`);
  return p;
}

function prefsKeys(store: string): string[] {
  const keys: string[] = [];
  const it = prefs(store).getAll()?.keySet()?.iterator();
  while (it?.hasNext()) {
    const key = it.next();
    if (key !== null) keys.push(key);
  }
  return keys;
}

// --- The module --------------------------------------------------------------

/** Stores a string, a number or a boolean under `key` in `store`. */
export function set(store: string, key: string, value: Value): void {
  if (PLATFORM === "ios") {
    // set(_:forKey:) takes Any?: a string, a number and a boolean become NSString, NSNumber.
    suite(store).set(value, key);
  } else {
    const edit = prefs(store).edit();
    if (typeof value === "string") edit?.putString(key, value)?.apply();
    else if (typeof value === "boolean") edit?.putBoolean(key, value)?.apply();
    else edit?.putString(key, `${NUMBER}${value}`)?.apply();
  }
  changed(store, key, false);
}

export function getString(store: string, key: string): string | null {
  if (PLATFORM === "ios") return suite(store).string(key);
  const text = prefs(store).getString(key, null);
  return text !== null && text.startsWith(NUMBER) ? null : text;
}

export function getNumber(store: string, key: string): number | null {
  if (PLATFORM === "ios") {
    const defaults = suite(store);
    return defaults.object(key) === null ? null : defaults.double(key);
  }
  const text = prefs(store).getString(key, null);
  return text !== null && text.startsWith(NUMBER) ? Number(text.slice(NUMBER.length)) : null;
}

export function getBoolean(store: string, key: string): boolean | null {
  if (PLATFORM === "ios") {
    const defaults = suite(store);
    return defaults.object(key) === null ? null : defaults.bool(key);
  }
  const p = prefs(store);
  return p.contains(key) ? p.getBoolean(key, false) : null;
}

export function has(store: string, key: string): boolean {
  if (PLATFORM === "ios") return suite(store).object(key) !== null;
  return prefs(store).contains(key);
}

export function remove(store: string, key: string): void {
  if (PLATFORM === "ios") suite(store).removeObject(key);
  else prefs(store).edit()?.remove(key)?.apply();
  changed(store, key, true);
}

/** The store's keys, sorted. */
export function keys(store: string): string[] {
  return (PLATFORM === "ios" ? suiteKeys(store) : prefsKeys(store)).sort();
}

export function clear(store: string): void {
  for (const key of keys(store)) remove(store, key);
}

/** Sends each change to any store to `onChange` until `signal` aborts. */
export async function watch(
  onChange: (change: Change) => void,
  signal: AbortSignal,
): Promise<void> {
  await subscribe<Change>(
    (next) => {
      const id = nextListener++;
      listeners.set(id, next);
      return () => {
        listeners.delete(id);
      };
    },
    onChange,
    signal,
  );
}
