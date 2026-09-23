import { DiagramArrow } from "./DiagramArrow";
import { DiagramBox } from "./DiagramBox";
import { DiagramLane } from "./DiagramLane";
import { DiagramNote } from "./DiagramNote";
import { DiagramSvg } from "./DiagramSvg";

const m = "pipeline-arrow";
const row1 = 50;
const row2 = 190;
const xs = [30, 250, 470, 690];

/** Source → TypeScript checker → lowering → C++ → native package → app build. */
export function PipelineDiagram() {
  return (
    <DiagramSvg viewBox="0 0 880 330" markerId={m} title="The Lucent build, from a source file to the app binary">
      <DiagramLane x={10} y={10} w={860} h={110} label="LUCENT BUILD · NODE" />
      <DiagramBox x={xs[0]!} y={row1} w={170} label="geo.lucent.ts" sub="your source" accent />
      <DiagramBox x={xs[1]!} y={row1} w={170} label="TypeScript checker" sub="strict · narrowed types" />
      <DiagramBox x={xs[2]!} y={row1} w={170} label="lowering" sub="subset · LUCENT codes" />
      <DiagramBox x={xs[3]!} y={row1} w={170} label="C++20 + JSI bindings" sub="one header per module" />
      {xs.slice(0, -1).map((x, i) => (
        <DiagramArrow key={x} from={[x + 170, row1 + 22]} to={[xs[i + 1]!, row1 + 22]} marker={m} />
      ))}

      <DiagramLane x={10} y={150} w={860} h={110} label="YOUR APP · XCODE / GRADLE" />
      <DiagramBox x={xs[3]!} y={row2} w={170} label=".lucent/native" sub="runtime + generated C++" />
      <DiagramBox x={xs[2]!} y={row2} w={170} label="autolinking" sub="CocoaPods · CMake" />
      <DiagramBox x={xs[1]!} y={row2} w={170} label="TurboModule “Lucent”" sub="pure C++, no codegen" />
      <DiagramArrow from={[xs[3]! + 85, row1 + 44]} to={[xs[3]! + 85, row2]} marker={m} />
      <DiagramArrow from={[xs[3]!, row2 + 22]} to={[xs[2]! + 170, row2 + 22]} marker={m} />
      <DiagramArrow from={[xs[2]!, row2 + 22]} to={[xs[1]! + 170, row2 + 22]} marker={m} />
      <DiagramNote x={30} y={row2 + 10} lines={["Metro swaps each", "*.lucent.ts import for", "a small JS proxy."]} />
      <DiagramNote
        x={30}
        y={300}
        lines={["Type errors and unsupported code stop the build with a diagnostic; nothing is written."]}
      />
    </DiagramSvg>
  );
}
