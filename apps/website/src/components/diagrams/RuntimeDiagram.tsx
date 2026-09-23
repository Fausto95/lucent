import { DiagramArrow } from "./DiagramArrow";
import { DiagramBox } from "./DiagramBox";
import { DiagramLabel } from "./DiagramLabel";
import { DiagramLane } from "./DiagramLane";
import { DiagramNote } from "./DiagramNote";
import { DiagramSvg } from "./DiagramSvg";

const m = "runtime-arrow";

/** A synchronous call stays on the JS thread; an async one hops to the Lucent thread and back. */
export function RuntimeDiagram() {
  return (
    <DiagramSvg viewBox="0 0 880 300" markerId={m} title="Where Lucent code runs when JavaScript calls it">
      <DiagramLane x={10} y={10} w={420} h={280} label="JS THREAD" />
      <DiagramBox x={30} y={60} w={185} label="squaredDistance(a, b)" sub="your app" accent />
      <DiagramBox x={240} y={60} w={170} label="compiled C++" sub="runs inline, returns" />
      <DiagramArrow from={[215, 82]} to={[240, 82]} marker={m} />
      <DiagramLabel x={228} y={52} text="JSI" />

      <DiagramBox x={30} y={180} w={185} label="await hashMany(xs)" sub="your app" accent />
      <DiagramBox x={240} y={220} w={170} label="promise resolves" sub="value converted to JS" />

      <DiagramLane x={450} y={10} w={420} h={280} label="LUCENT THREAD" />
      <DiagramBox x={520} y={180} w={280} label="async function body" sub="C++20 coroutine · awaits interleave" />
      <DiagramArrow from={[215, 202]} to={[520, 202]} marker={m} />
      <DiagramArrow from={[520, 232]} to={[410, 242]} marker={m} />
      <DiagramNote
        x={480}
        y={70}
        lines={["One lock serializes all Lucent code,", "so it runs one piece at a time,", "like JavaScript: no data races."]}
      />
    </DiagramSvg>
  );
}
