import { DiagramArrow } from "./DiagramArrow";
import { DiagramBox } from "./DiagramBox";
import { DiagramLabel } from "./DiagramLabel";
import { DiagramLane } from "./DiagramLane";
import { DiagramNote } from "./DiagramNote";
import { DiagramSvg } from "./DiagramSvg";

const m = "runtime-arrow";

/** A call from app code into the compiled native body, and back. */
export function RuntimeDiagram() {
  return (
    <DiagramSvg
      viewBox="0 0 900 300"
      markerId={m}
      title="How a call travels from JavaScript into compiled native code at runtime"
    >
      <DiagramLane x={20} y={20} w={860} h={112} label="JAVASCRIPT · HERMES" />
      <DiagramBox x={40} y={60} w={240} label="App.tsx" sub="clamp(15, 0, 10)" />
      <DiagramBox x={340} y={60} w={250} label="geo.lucent.js" sub="generated proxy · lucentCall()" />
      <DiagramBox x={640} y={60} w={220} label="Expo Modules · Nitro" sub="JSI call, typed arguments" />
      <DiagramArrow from={[280, 82]} to={[340, 82]} marker={m} />
      <DiagramArrow from={[590, 82]} to={[640, 82]} marker={m} />

      <DiagramLane x={20} y={160} w={860} h={112} label="NATIVE · SWIFT / KOTLIN" />
      <DiagramBox x={640} y={200} w={220} label="LucentGeoModule.clamp" sub="generated wrapper" accent />
      <DiagramBox x={340} y={200} w={250} label="if value < min { return min }" sub="your function, compiled" />
      <DiagramArrow from={[750, 104]} to={[750, 200]} marker={m} />
      <DiagramArrow from={[640, 222]} to={[590, 222]} marker={m} />
      <DiagramArrow from={[340, 222]} to={[160, 222]} marker={m} dashed />
      <DiagramLabel x={166} y={212} text="returns 10 · or a Promise" anchor="start" />
      <DiagramNote
        x={40}
        y={246}
        lines={["No interpreter and no JSON on the native side.", "Errors come back as LucentError."]}
      />
    </DiagramSvg>
  );
}
