import { DiagramArrow } from "./DiagramArrow";
import { DiagramBox } from "./DiagramBox";
import { DiagramLane } from "./DiagramLane";
import { DiagramNote } from "./DiagramNote";
import { DiagramSvg } from "./DiagramSvg";

const m = "platform-call-arrow";
const laneW = 265;
const laneX = [10, 285] as const;
const x = laneX.map((l) => l + 15);
const w = laneW - 30;
const routeY = (i: number) => 172 + i * 54;

/** Each platform's routes, by what the member is; the sample's calls take the highlighted ones. */
const routes = [
  [
    { label: "Objective-C", sub: "a message send", accent: true },
    { label: "generated Swift", sub: "Swift-only APIs" },
    { label: "C", sub: "C functions, extensions" },
  ],
  [
    { label: "JNI", sub: "Java methods and fields", accent: true },
    { label: "generated Kotlin", sub: "suspend, value classes" },
    { label: "C", sub: "native extensions" },
  ],
] as const;

/** Where each platform's declarations are read from. */
const sources = [
  { label: "Xcode's SDK · pods", sub: "headers, Swift symbol graphs" },
  { label: "Android SDK · Gradle", sub: "class files, Kotlin metadata" },
] as const;

/** One SDK call in a module, the route each platform's build compiles it to, and where its declarations come from. */
export function PlatformCallDiagram() {
  const lanesY = 144;
  const sourcesY = routeY(3) + 26;

  return (
    <DiagramSvg
      viewBox={`0 0 560 ${sourcesY + 96}`}
      markerId={m}
      title="An SDK call compiles to one of five routes: Objective-C, generated Swift, JNI, generated Kotlin or C"
    >
      <DiagramBox
        x={x[0]}
        y={14}
        w={x[1] + w - x[0]}
        label="device.lucent.ts"
        sub="one module, a branch per platform"
      />
      <DiagramBox
        x={x[0]}
        y={84}
        w={w}
        label="UIDevice.current.model"
        sub="the iOS branch"
        accent
      />
      <DiagramBox x={x[1]} y={84} w={w} label="Build.MODEL" sub="the Android branch" accent />
      {routes.map((platform, p) => (
        <g key={p}>
          <DiagramLane
            x={laneX[p]}
            y={lanesY}
            w={laneW}
            h={sourcesY - lanesY - 12}
            label={p === 0 ? "IOS" : "ANDROID"}
          />
          {platform.map((r, i) => (
            <DiagramBox
              key={r.label}
              x={x[p]}
              y={routeY(i)}
              w={w}
              h={40}
              label={r.label}
              sub={r.sub}
              accent={"accent" in r}
            />
          ))}
          <DiagramBox x={x[p]} y={sourcesY} w={w} label={sources[p].label} sub={sources[p].sub} />
        </g>
      ))}
      {x.map((left) => (
        <g key={left}>
          <DiagramArrow from={[left + w / 2, 58]} to={[left + w / 2, 84]} marker={m} />
          <DiagramArrow from={[left + w / 2, 128]} to={[left + w / 2, routeY(0)]} marker={m} />
          <DiagramArrow
            from={[left + w / 2, sourcesY]}
            to={[left + w / 2, sourcesY - 30]}
            marker={m}
            dashed
          />
        </g>
      ))}
      <DiagramNote
        x={20}
        y={sourcesY + 72}
        lines={[
          "Each member takes one route, chosen from its declaration;",
          "declarations are read from your SDKs and libraries, then cached.",
        ]}
      />
    </DiagramSvg>
  );
}
