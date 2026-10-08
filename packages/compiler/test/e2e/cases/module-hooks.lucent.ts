import { onDestroy } from "lucent:core";

const log: string[] = [];

// Module code's destroy hook: it runs when this module's state ends (a
// reload), which a run of the case never reaches.
const stopLogging = onDestroy(() => {
  log.push("destroyed");
});

export function hooks(): string {
  const stop = onDestroy(() => {
    log.push("never");
  });
  stop();
  stop();
  return `${log.length} ${typeof stop} ${typeof stopLogging}`;
}
