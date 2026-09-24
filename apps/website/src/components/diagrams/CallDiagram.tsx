import { DiagramArrow } from "./DiagramArrow";
import { DiagramBox } from "./DiagramBox";
import { DiagramLabel } from "./DiagramLabel";
import { DiagramLane } from "./DiagramLane";
import { DiagramSvg } from "./DiagramSvg";

type Lane = 0 | 1;
interface Hop {
  label: string;
  sub?: string;
  lane: Lane;
  accent?: boolean;
  /** Names the arrow into this box, where the call changes thread. */
  via?: string;
}

const sync: Hop[] = [
  { label: 'greet("Ada")', sub: "your JavaScript", lane: 0, accent: true },
  { label: "proxy", sub: "greet.lucent → the module", lane: 0 },
  { label: "JSI", sub: "a host function call", lane: 0 },
  { label: "argument conversion", sub: "checks each value's type", lane: 0 },
  { label: "your C++", sub: "greet runs", lane: 0, accent: true },
  { label: "return conversion", sub: "C++ value → JS value", lane: 0 },
  { label: '"Hello, Ada!"', sub: "returned to JavaScript", lane: 0 },
];

const async: Hop[] = [
  { label: "await mean(values)", sub: "your JavaScript", lane: 0, accent: true },
  { label: "proxy · JSI", sub: "a host function call", lane: 0 },
  { label: "argument conversion", sub: "checks, then copies", lane: 0 },
  { label: "your C++", sub: "a coroutine", lane: 1, accent: true, via: "posted" },
  { label: "return conversion", sub: "C++ value → JS value", lane: 0, via: "posted back" },
  { label: "promise resolves", sub: "in JavaScript", lane: 0 },
];

const laneX = [20, 230] as const;
const w = 190;
const top = (i: number) => 44 + i * 64;

/** A call through the boundary, one box per step, in the lane of the thread it runs on. */
export function CallDiagram({ mode }: { mode: "sync" | "async" }) {
  const hops = mode === "sync" ? sync : async;
  const m = `call-arrow-${mode}`;
  const height = top(hops.length) + 4;
  const lanes = mode === "sync" ? ["JS THREAD"] : ["JS THREAD", "LUCENT THREAD"];
  return (
    <DiagramSvg viewBox={`0 0 440 ${height}`} markerId={m} title={`A ${mode === "sync" ? "synchronous" : "async"} call, step by step, with the thread each step runs on`}>
      {lanes.map((label, i) => (
        <DiagramLane key={label} x={laneX[i as Lane] - 10} y={10} w={w + 20} h={height - 14} label={label} />
      ))}
      {hops.map((hop, i) => {
        const x = laneX[hop.lane];
        const prev = hops[i - 1];
        return (
          <g key={hop.label}>
            <DiagramBox x={x} y={top(i)} w={w} label={hop.label} sub={hop.sub} accent={hop.accent} />
            {prev &&
              (prev.lane === hop.lane ? (
                <DiagramArrow from={[x + w / 2, top(i - 1) + 44]} to={[x + w / 2, top(i)]} marker={m} />
              ) : (
                <DiagramArrow
                  from={[laneX[prev.lane] + (hop.lane > prev.lane ? w : 0), top(i - 1) + 22]}
                  to={[x + (hop.lane > prev.lane ? 0 : w), top(i) + 22]}
                  marker={m}
                  dashed
                />
              ))}
            {hop.via && <DiagramLabel x={laneX[1] + 8} y={(top(i - 1) + top(i)) / 2 + 26} text={hop.via} anchor="start" />}
          </g>
        );
      })}
    </DiagramSvg>
  );
}
