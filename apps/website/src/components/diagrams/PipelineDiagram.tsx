import { DiagramArrow } from "./DiagramArrow";
import { DiagramBox } from "./DiagramBox";
import { DiagramNote } from "./DiagramNote";
import { DiagramSvg } from "./DiagramSvg";
import { FONT, palette } from "./palette";

const m = "pipeline-arrow";
const row1 = 30;
const row2 = 140;
const row3 = 240;
const xs = [20, 192, 364, 536, 708];

/** Source → parser → checker → lowering → IR → backends → host → package. */
export function PipelineDiagram() {
  return (
    <DiagramSvg
      viewBox="0 0 900 380"
      markerId={m}
      title="The Lucent compile pipeline from a source file to a native package"
    >
      <DiagramBox x={xs[0]!} y={row1} w={140} label="geo.lucent.ts" sub="your source" accent />
      <DiagramBox x={xs[1]!} y={row1} w={140} label="parse" sub="oxc-parser" />
      <DiagramBox x={xs[2]!} y={row1} w={140} label="check" sub="types · scopes · LUCENT codes" />
      <DiagramBox x={xs[3]!} y={row1} w={140} label="lower" sub="JS-only forms removed" />
      <DiagramBox x={xs[4]!} y={row1} w={140} label="IR" sub="typed, structured" />
      {xs.slice(0, -1).map((x, i) => (
        <DiagramArrow key={x} from={[x + 140, row1 + 22]} to={[xs[i + 1]!, row1 + 22]} marker={m} />
      ))}

      <DiagramBox x={536} y={row2} w={140} label="backend-swift" sub="IR → Swift text" />
      <DiagramBox x={708} y={row2} w={140} label="backend-kotlin" sub="IR → Kotlin text" />
      <DiagramArrow from={[778, row1 + 44]} to={[606, row2]} marker={m} />
      <DiagramArrow from={[778, row1 + 44]} to={[778, row2]} marker={m} />
      <DiagramNote
        x={20}
        y={row2 + 14}
        lines={[
          "Every phase is pure: source text in, IR and",
          "diagnostics out. The compiler stops after the",
          "first phase that reports an error.",
        ]}
      />

      <DiagramBox
        x={536}
        y={row3}
        w={312}
        label="host-expo · host-nitro"
        sub="module wrapper + JS proxy + package files"
      />
      <DiagramArrow from={[606, row2 + 44]} to={[606, row3]} marker={m} />
      <DiagramArrow from={[778, row2 + 44]} to={[778, row3]} marker={m} />
      <DiagramNote
        x={20}
        y={row3 + 14}
        lines={[
          "Backends only know the IR. Hosts wrap the",
          "generated bodies in an Expo Module or a Nitro",
          "HybridObject and write the JS proxy.",
        ]}
      />

      <DiagramArrow from={[692, row3 + 44]} to={[692, 318]} marker={m} />
      <rect x="20" y="318" width="828" height="44" rx="6" style={{ fill: palette.boxFill, stroke: palette.boxStroke }} />
      <text x="34" y="345" fontFamily={FONT} fontSize="12" style={{ fill: palette.text }}>
        <tspan style={{ fill: palette.accent }}>modules/lucent/</tspan>
        <tspan dx="18">ios/LucentGeoModule.swift</tspan>
        <tspan dx="18">android/…/LucentGeoModule.kt</tspan>
        <tspan dx="18">geo.lucent.js + .d.ts</tspan>
      </text>
    </DiagramSvg>
  );
}
