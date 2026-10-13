// What only the platform gives module code (T108–T110): the device runs open
// this screen after the Tests screen, on the simulator and the emulator.
import { Linking, Platform } from "react-native";
import { holdBack } from "../../navigation/useNavigator";
import * as Probe from "../../sdk/platform.lucent";
import type { SdkCase } from "../sdk/types";
import { SCHEME } from "./scheme";

const ios = Platform.OS === "ios";

/** What `read` gives once `done` says so, or what it gave last after `ms`. */
async function poll<T>(
  ms: number,
  read: () => Promise<T>,
  done: (value: T) => boolean,
): Promise<T> {
  const until = Date.now() + ms;
  let value = await read();
  while (!done(value) && Date.now() < until) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    value = await read();
  }
  return value;
}

/** The app opens a link to itself: the app delegate (iOS) or the Activity (Android) gives it to the module. */
async function deepLink(): Promise<string> {
  await Probe.watchLinks();
  const url = `${SCHEME}://lucent-probe/${Date.now()}`;
  await Linking.openURL(url);

  const heard = await poll(10_000, Probe.lastLinkHeard, (got) => got === url);
  return heard === url ? "heard" : heard || "nothing heard";
}

async function push(): Promise<string> {
  await Probe.registerForPush();
  return (await poll(20_000, Probe.pushAnswered, (got) => got !== "")) || "no answer";
}

/** The navigator lets this press through, as a screen with nothing to go back to would. */
async function back(): Promise<string> {
  const release = holdBack();
  try {
    return await Probe.pressBack();
  } finally {
    release();
  }
}

export const platformCases: SdkCase[] = [
  {
    name: "executor: frames reach a channel, uncopied",
    run: Probe.frames,
    expected: ios ? "4 frames, 0 copies" : /^([1-9]\d*) frames, \1 adopted, 0 copies, red 255$/,
  },
  { name: "deep link: the app opens one to itself", run: deepLink, expected: "heard" },
  {
    name: "push: a token, or why there is none",
    run: push,
    expected: ios ? /^(token of \d+ bytes|failed: .+)$/ : "none",
  },
  {
    name: "back: a press JavaScript lets through reaches the module",
    run: back,
    expected: ios ? "none" : "consumed",
  },
  { name: "configuration: a rotation", run: Probe.rotate, expected: ios ? "none" : "changed" },
];
