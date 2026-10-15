// What only the platform gives module code (T108–T110, T130, T131), a
// component's React Native view props (T121), and the app's native code
// calling a module (T114): the device runs open this screen after the Tests
// screen, on the simulator and the emulator.
import { Linking, Platform } from "react-native";
import { isRegistered, runAsScheduled, schedule, workInBackground } from "lucent-background-task";
import { heard, Pinger, send } from "lucent-broadcast";
import { cardShown, showAndRestore } from "lucent-fragment";
import { channelReady, startedAtMs } from "lucent-launch";
import { BUNDLE_STARTED } from "../../bundleStarted";
import { holdBack } from "../../navigation/useNavigator";
import * as Probe from "../../sdk/platform.lucent";
import type { SdkCase } from "../sdk/types";
import { cardLayout } from "./cardLayout";
import { nativeCallerCases } from "./nativeCallers";
import { SCHEME } from "./scheme";

const ios = Platform.OS === "ios";

/** The screen's card's testID and accessibilityLabel, which cases read from its native view. */
export const CARD_ID = "lucent-card";
export const CARD_LABEL = "A card, as React Native labels views";

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

/**
 * A launch module's state started at launch, before JavaScript: from the
 * app delegate (iOS) or LucentInitializer (Android), which also created a
 * notification channel with the app's context.
 */
async function launched(): Promise<string> {
  const started = startedAtMs();
  if (started > BUNDLE_STARTED) return `started ${started - BUNDLE_STARTED} ms after JavaScript`;
  if (!ios && !channelReady()) return "no notification channel";
  return "before JavaScript";
}

/** The background refresh's handler, as the scheduler would run it: to the end, then cut short. */
async function backgroundRuns(): Promise<string> {
  return `${await runAsScheduled(-1)}, ${await runAsScheduled(50)}`;
}

/** A broadcast to the app's own receiver, which Android makes by its name from a Lucent class (T131). */
async function received(): Promise<string> {
  send();
  return poll(
    10_000,
    async () => heard(),
    (got) => got !== "0 ",
  );
}

export const platformCases: SdkCase[] = [
  {
    name: "launch: a launch module's state starts before JavaScript",
    run: launched,
    expected: "before JavaScript",
  },
  {
    name: "background task: launch registered the handler in time",
    run: async () => String(isRegistered()),
    expected: ios ? "true" : "false",
  },
  {
    name: "background task: the scheduler takes a request, or says why not",
    run: async () => schedule(),
    expected: ios ? /^(scheduled|not scheduled: .+)$/ : "none",
  },
  {
    name: "background task: a run completes, and an expiration stops one",
    run: backgroundRuns,
    expected: "completed, expired",
  },
  {
    name: "receiver: Android makes a Lucent BroadcastReceiver by its name",
    run: received,
    expected: ios ? "none" : "1 dev.lucent.example.PING",
  },
  {
    name: "platform class: a class each platform file writes, as its declaration says",
    run: async () => {
      const pinger = new Pinger("lab");
      pinger.ping();
      pinger.ping();
      return `${pinger.label} ${pinger.sent} ${pinger.ping()}`;
    },
    expected: ios ? "lab 2 false" : "lab 2 true",
  },
  {
    name: "fragment: Android makes a Lucent Fragment again by its name, with its state",
    run: showAndRestore,
    expected: ios ? "none" : "made 2, views 2, restored kept",
  },
  {
    name: "fragment root: a component's Fragment shows its view in the component",
    run: () => poll(10_000, cardShown, (got) => got === "shown" || got === "none"),
    expected: ios ? "none" : "shown",
  },
  {
    name: "view props: the native view has the testID, and the accessibility API reads its label",
    run: () =>
      poll(
        10_000,
        () => Probe.labelOf(CARD_ID),
        (got) => got !== "no view",
      ),
    expected: CARD_LABEL,
  },
  {
    name: "view props: onLayout fires with the component's size",
    run: () =>
      poll(
        10_000,
        async () => cardLayout(),
        (got) => got !== "",
      ),
    expected: "laid out",
  },
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
  {
    name: "keys: a key the app didn't handle reaches the module",
    run: Probe.pressKey,
    expected: ios ? "none" : "down 142, up 142",
  },
  { name: "configuration: a rotation", run: Probe.rotate, expected: ios ? "none" : "changed" },
  ...nativeCallerCases,
  // Last: it leaves the app in the background, where React Native's timers stop.
  {
    name: "background work: WorkManager runs a Lucent Worker with the app in the background",
    run: () => workInBackground(60_000),
    expected: ios ? "none" : "ran in the background",
  },
];
