import { PLATFORM } from "lucent:platform";
import { appContext } from "lucent:android";
import type { DataStore } from "lucent:android/androidx.datastore.core";
import {
  type Preferences,
  PreferenceDataStoreFactory,
  PreferencesKeys,
  PreferencesKt,
} from "lucent:android/androidx.datastore.preferences.core";
import { File } from "lucent:android/java.io";
import { FlowKt } from "lucent:android/kotlinx.coroutines.flow";
import { delay } from "lucent:core";

const NONE = "no DataStore on iOS";

// DataStore allows one active store per file in a process.
let store: DataStore<Preferences> | undefined;

/** The example's store, created on first use; Kotlin's defaults for everything but its file. */
function preferences(): DataStore<Preferences> {
  store ??= PreferenceDataStoreFactory.INSTANCE.create(
    undefined,
    undefined,
    undefined,
    () => new File(appContext().getFilesDir(), "lucent-orbit.preferences_pb"),
  );
  return store;
}

/** A transaction's result, and the store read back: what edit() wrote. */
export async function preferencesEdit(): Promise<string> {
  if (PLATFORM === "ios") {
    return NONE;
  } else {
    const prefs = preferences();
    const visits = PreferencesKeys.stringPreferencesKey("visits");
    const dark = PreferencesKeys.booleanPreferencesKey("dark");

    await PreferencesKt.edit(prefs, (p) => {
      p.clear();
    });
    const edited = await PreferencesKt.edit(prefs, (p) => {
      p.set(visits, `${Number(p.get(visits) ?? "0") + 1}`);
      p.set(dark, true);
    });
    const read = await FlowKt.first(prefs.data);

    return `${edited.get(visits)} ${edited.get(dark)} ${read.get(visits)} ${read.contains(dark)}`;
  }
}

/** A transaction whose function throws: nothing is written, and the call rejects with that error. */
export async function preferencesRollback(): Promise<string> {
  if (PLATFORM === "ios") {
    return NONE;
  } else {
    const prefs = preferences();
    const visits = PreferencesKeys.stringPreferencesKey("visits");
    await PreferencesKt.edit(prefs, (p) => {
      p.set(visits, "1");
    });

    let failed = "";
    try {
      await PreferencesKt.edit(prefs, (p) => {
        p.set(visits, "2");
        throw new RangeError("no more visits");
      });
    } catch (e) {
      failed = `${(e as Error).name}: ${(e as Error).message}`;
    }

    return `${failed} ${(await FlowKt.first(prefs.data)).get(visits)}`;
  }
}

/** The store's data flow: its value when collected, then each edit, until cancelled. */
export async function preferencesFlow(): Promise<string> {
  if (PLATFORM === "ios") {
    return NONE;
  } else {
    const prefs = preferences();
    const theme = PreferencesKeys.stringPreferencesKey("theme");
    await PreferencesKt.edit(prefs, (p) => {
      p.set(theme, "light");
    });

    const controller = new AbortController();
    const seen: string[] = [];
    const collecting = prefs.data.collect((p) => {
      const value = p.get(theme) ?? "-";
      if (seen.at(-1) !== value) seen.push(value);
      if (value === "dark") controller.abort();
    }, controller.signal);

    for (let i = 0; i < 100 && seen.length === 0; i++) await delay(10);
    await PreferencesKt.edit(prefs, (p) => {
      p.set(theme, "dark");
    });

    let outcome = "completed";
    try {
      await collecting;
    } catch (e) {
      outcome = (e as Error).name;
    }
    return `${seen.join(",")} ${outcome}`;
  }
}
