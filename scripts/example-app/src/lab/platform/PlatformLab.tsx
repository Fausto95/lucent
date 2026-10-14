import { Card } from "lucent-fragment";
import { Stack } from "../../ui/Stack";
import { RunPanel } from "../RunPanel";
import { ProbeRow } from "../sdk/ProbeRow";
import { runProbe } from "../sdk/runProbe";
import { useChecks } from "../useChecks";
import { platformCases } from "./cases";

/** What only the platform gives module code: executors' frames, deep links, push tokens, back presses. */
export function PlatformLab() {
  const { results, running, summary, run } = useChecks("platform", platformCases, runProbe);

  const passed = results.filter((r) => r.pass).length;

  return (
    <Stack>
      <RunPanel
        running={running}
        result={summary}
        progress={`${results.length}/${platformCases.length} run · ${passed} passed`}
        onRun={run}
      />

      {/* A component whose Android root is a Fragment: a case checks it shows (lucent-fragment). */}
      <Card text="A Fragment, as a component's root" style={{ height: 40 }} />

      {results.map((result) => (
        <ProbeRow key={result.name} result={result} />
      ))}
    </Stack>
  );
}
