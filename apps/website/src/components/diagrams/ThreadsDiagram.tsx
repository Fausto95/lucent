import { DiagramArrow } from "./DiagramArrow";
import { DiagramBox } from "./DiagramBox";
import { DiagramLabel } from "./DiagramLabel";
import { DiagramLane } from "./DiagramLane";
import { DiagramNote } from "./DiagramNote";
import { DiagramSvg } from "./DiagramSvg";

const m = "threads-arrow";
const lanes = ["JS", "LUCENT", "WORKERS", "MAIN"] as const;
const laneW = 130;
const laneX = (i: number) => 8 + i * (laneW + 8);
const x = (i: number) => laneX(i) + 8;
const w = laneW - 16;
const row = (i: number) => 40 + i * 70;

/** What runs on each thread, which of it shares the lock module code takes, and how work moves between threads. */
export function ThreadsDiagram() {
  return (
    <DiagramSvg
      viewBox="0 0 560 380"
      markerId={m}
      title="The JS thread, the Lucent thread, compute workers and the main thread, and what runs on each"
    >
      {lanes.map((label, i) => (
        <DiagramLane key={label} x={laneX(i)} y={10} w={laneW} h={310} label={label} />
      ))}
      <DiagramBox x={x(0)} y={row(0)} w={w} label="sync export" sub="runs here" accent />
      <DiagramBox x={x(0)} y={row(1)} w={w} label="async export" sub="converts args" />
      <DiagramBox x={x(1)} y={row(1)} w={w} label="its body" sub="runs here" accent />
      <DiagramBox x={x(2)} y={row(1)} w={w} label="compute(task)" sub="runs here" accent />
      <DiagramBox x={x(3)} y={row(2)} w={w} label="main(() => …)" sub="runs here" accent />
      <DiagramBox x={x(3)} y={row(3)} w={w} label="view setup" sub="main context" accent />
      <DiagramBox x={x(1)} y={row(3)} w={w} label="SDK callback" sub="queued here" />
      <DiagramBox x={x(0)} y={row(3)} w={w} label="JS callback" sub="posted here" />
      <DiagramArrow from={[x(0) + w, row(1) + 22]} to={[x(1), row(1) + 22]} marker={m} dashed />
      <DiagramLabel x={laneX(1)} y={row(1) - 8} text="posted" />
      <DiagramArrow from={[x(1) + w, row(1) + 22]} to={[x(2), row(1) + 22]} marker={m} dashed />
      <DiagramArrow from={[x(1) + w / 2, row(1) + 44]} to={[x(3), row(2) + 22]} marker={m} dashed />
      <DiagramArrow from={[x(1), row(3) + 22]} to={[x(0) + w, row(3) + 22]} marker={m} dashed />
      <DiagramNote
        x={16}
        y={346}
        lines={[
          "Module code takes turns under one lock: sync exports, async bodies, main(f).",
          "Compute tasks and view setups run beside it, without the lock.",
        ]}
      />
    </DiagramSvg>
  );
}
