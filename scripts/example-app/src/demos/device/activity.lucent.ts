// The Activity in front and its lifecycle, on Android: lucent:android
// tracks the app's Activities from the process's start, weakly, so the
// module asks for the current one when it needs it and keeps none.
import { PLATFORM } from "lucent:platform";
import { type ActivityEvent, currentActivity, onActivityEvent } from "lucent:android";
import { main } from "lucent:thread";

/** The class of the Activity in front, or null (none, or iOS). */
export async function currentActivityAsync(): Promise<string | null> {
  if (PLATFORM !== "android") return null;

  return main(() => currentActivity()?.getLocalClassName() ?? null);
}

// The latest lifecycle events, newest last.
const latest: string[] = [];
const stops: (() => void)[] = [];

function record(event: string, name: string | null): void {
  latest.push(`${event} ${name ?? "?"}`);
  if (latest.length > 8) latest.shift();
}

/** Starts recording the Activities' lifecycle events (once). */
export function watchLifecycle(): void {
  if (PLATFORM !== "android") return;
  if (stops.length) return;

  const events: ActivityEvent[] = ["created", "resumed", "paused", "destroyed"];

  for (const event of events)
    stops.push(onActivityEvent(event, (activity) => record(event, activity.getLocalClassName())));
}

/** The latest lifecycle events, newest last. */
export function lifecycleEvents(): string[] {
  return [...latest];
}
