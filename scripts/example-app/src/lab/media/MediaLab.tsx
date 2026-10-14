import { Stack } from "../../ui/Stack";
import { RunPanel } from "../RunPanel";
import { ProbeRow } from "../sdk/ProbeRow";
import { runProbe } from "../sdk/runProbe";
import { useChecks } from "../useChecks";
import { mediaCases } from "./cases";

/** A foreground service written in Lucent, which outlives the Activity that started it. */
export function MediaLab() {
  const { results, running, summary, run } = useChecks("media", mediaCases, runProbe);

  const passed = results.filter((r) => r.pass).length;

  return (
    <Stack>
      <RunPanel
        running={running}
        result={summary}
        progress={`${results.length}/${mediaCases.length} run · ${passed} passed`}
        onRun={run}
      />

      {results.map((result) => (
        <ProbeRow key={result.name} result={result} />
      ))}
    </Stack>
  );
}
