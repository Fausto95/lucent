import { DiagramArrow } from "./DiagramArrow";
import { DiagramBox } from "./DiagramBox";
import { DiagramLane } from "./DiagramLane";
import { DiagramSvg } from "./DiagramSvg";

const m = "places-arrow";
const crossings = [
  { label: "values are copied", sub: "numbers · strings · arrays · objects" },
  { label: "instances keep identity", sub: "class instances, by reference" },
  { label: "functions become callbacks", sub: "retained until Lucent drops them" },
  { label: "promises stay promises", sub: "in both directions" },
];

/** Your JavaScript, the boundary between it and native code, and your module with the SDKs it calls. */
export function PlacesDiagram() {
  return (
    <DiagramSvg
      viewBox="0 0 440 470"
      markerId={m}
      title="The three places your code runs, and what crosses between them"
    >
      <DiagramLane x={10} y={10} w={420} h={80} label="1 · THE JS APP" />
      <DiagramBox
        x={80}
        y={36}
        w={280}
        label="your components and JS code"
        sub="Hermes, on the JS thread"
        accent
      />
      <DiagramLane x={10} y={110} w={420} h={250} label="2 · THE BOUNDARY" />
      {crossings.map((c, i) => (
        <DiagramBox key={c.label} x={40} y={138 + i * 54} w={360} label={c.label} sub={c.sub} />
      ))}
      <DiagramLane x={10} y={380} w={420} h={80} label="3 · NATIVE" />
      <DiagramBox
        x={80}
        y={406}
        w={280}
        label="your module's C++ · the SDKs"
        sub="JS thread · Lucent thread · main thread"
        accent
      />
      <DiagramArrow from={[200, 80]} to={[200, 138]} marker={m} />
      <DiagramArrow from={[200, 350]} to={[200, 406]} marker={m} />
      <DiagramArrow from={[240, 406]} to={[240, 350]} marker={m} />
      <DiagramArrow from={[240, 138]} to={[240, 80]} marker={m} />
    </DiagramSvg>
  );
}
