import { DiagramArrow } from "./DiagramArrow";
import { DiagramBox } from "./DiagramBox";
import { DiagramLabel } from "./DiagramLabel";
import { DiagramSvg } from "./DiagramSvg";

const x = 70;
const w = 300;
const stages = [
  { label: "greet.lucent.ts", sub: "your module" },
  { label: "TypeScript checker", sub: "Lucent's rules · LUCENT codes" },
  { label: "C++", sub: "one file per module · #line to your source" },
  { label: ".lucent/native", sub: "the native package" },
  { label: "Xcode · Gradle", sub: "CocoaPods · CMake · into your app" },
];
const top = (i: number) => 20 + i * 72;
const metroY = top(stages.length);

/** The build, top to bottom; `step` (1–5) highlights the stage a section explains. Metro works beside it. */
export function BuildDiagram({ step }: { step: number }) {
  const m = `build-arrow-${step}`;
  return (
    <DiagramSvg
      viewBox={`0 0 440 ${metroY + 64}`}
      markerId={m}
      title={`The build, step ${step}: ${step === 5 ? "Metro" : stages[step]!.label}`}
    >
      {stages.map((s, i) => (
        <g key={s.label}>
          <DiagramBox x={x} y={top(i)} w={w} label={s.label} sub={s.sub} accent={i === step} />
          {i > 0 && <DiagramLabel x={x - 22} y={top(i) + 27} text={String(i)} />}
          {i > 0 && (
            <DiagramArrow from={[x + w / 2, top(i - 1) + 44]} to={[x + w / 2, top(i)]} marker={m} />
          )}
        </g>
      ))}
      <DiagramBox
        x={x}
        y={metroY}
        w={w}
        label="Metro"
        sub="each import → a proxy in the JS bundle"
        accent={step === 5}
      />
      <DiagramLabel x={x - 22} y={metroY + 27} text="5" />
      <DiagramArrow from={[x + w, top(0) + 22]} to={[x + w + 30, top(0) + 22]} marker={m} dashed />
      <DiagramArrow
        from={[x + w + 30, top(0) + 22]}
        to={[x + w + 30, metroY + 22]}
        marker={m}
        dashed
      />
      <DiagramArrow from={[x + w + 30, metroY + 22]} to={[x + w, metroY + 22]} marker={m} dashed />
    </DiagramSvg>
  );
}
