// The views spike's module code: the work its isolation phases run while
// the Tickers' native timers go on, and how many times JavaScript started
// in this process (a JavaScript reload starts it again).
import { appContext } from "lucent:android";
import { ProcessInfo, UserDefaults } from "lucent:ios/Foundation";
import { Process } from "lucent:android/android.os";
import { compute } from "lucent:core";
import { PLATFORM } from "lucent:platform";

/** Keeps the calling thread busy for `ms`: when it started and ended. */
function busy(ms: number): number[] {
  const start = Date.now();
  let x = 0;

  while (Date.now() - start < ms) x = (x * 31 + 7) % 1000003;

  return [start, Date.now(), x];
}

/** `busy` as a compute task, on a worker: JavaScript and the main thread go on. */
export async function isolated(ms: number): Promise<number[]> {
  return await compute(busy, ms);
}

/** `busy` as module code, on the calling (JavaScript) thread, holding the Lucent lock. */
export function locked(ms: number): number[] {
  return busy(ms);
}

const PID_KEY = "lucentViewsSpikePid";
const STARTS_KEY = "lucentViewsSpikeStarts";

/** The number of times JavaScript started in this process, this one included. */
export function starts(): number {
  if (PLATFORM === "ios") {
    const defaults = UserDefaults.standard;
    const pid = BigInt(ProcessInfo.processInfo.processIdentifier);
    const count = defaults.integer(PID_KEY) === pid ? defaults.integer(STARTS_KEY) + 1n : 1n;

    defaults.set(pid, PID_KEY);
    defaults.set(count, STARTS_KEY);

    return Number(count);
  }

  const prefs = appContext().getSharedPreferences("lucent-views-spike", 0);

  if (prefs === null) return 1;

  const pid = Process.myPid();
  const count = prefs.getInt(PID_KEY, 0) === pid ? prefs.getInt(STARTS_KEY, 0) + 1 : 1;

  prefs.edit()?.putInt(PID_KEY, pid)?.putInt(STARTS_KEY, count)?.commit();

  return count;
}
