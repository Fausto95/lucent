import { DiagramArrow } from "./DiagramArrow";
import { DiagramBox } from "./DiagramBox";
import { DiagramLane } from "./DiagramLane";
import { DiagramNote } from "./DiagramNote";
import { DiagramSvg } from "./DiagramSvg";

const m = "threads-arrow";
const x = [16, 160, 304] as const;
const w = 124;

/** What runs on each of the three threads, and how work moves between them. */
export function ThreadsDiagram() {
  return (
    <DiagramSvg viewBox="0 0 440 380" markerId={m} title="The JS thread, the Lucent thread and the main thread, and what runs on each">
      <DiagramLane x={8} y={10} w={140} h={310} label="JS" />
      <DiagramLane x={152} y={10} w={140} h={310} label="LUCENT" />
      <DiagramLane x={296} y={10} w={140} h={310} label="MAIN" />
      <DiagramBox x={x[0]} y={40} w={w} label="sync export" sub="runs here" accent />
      <DiagramBox x={x[0]} y={110} w={w} label="async export" sub="called here" />
      <DiagramBox x={x[1]} y={110} w={w} label="its body" sub="runs here" accent />
      <DiagramBox x={x[2]} y={180} w={w} label="main(() => …)" sub="UIKit, views" accent />
      <DiagramBox x={x[1]} y={250} w={w} label="SDK callback" sub="queued here" />
      <DiagramBox x={x[0]} y={250} w={w} label="JS callback" sub="posted here" />
      <DiagramArrow from={[x[0] + w, 132]} to={[x[1], 132]} marker={m} />
      <DiagramArrow from={[x[1] + w, 150]} to={[x[2] + 20, 180]} marker={m} dashed />
      <DiagramArrow from={[x[2], 290]} to={[x[1] + w, 272]} marker={m} dashed />
      <DiagramArrow from={[x[1], 272]} to={[x[0] + w, 272]} marker={m} />
      <DiagramNote x={16} y={346} lines={["One lock: Lucent code runs one piece at a time,", "on whichever thread, so it never races itself."]} />
    </DiagramSvg>
  );
}
