import { DiagramArrow } from "./DiagramArrow";
import { DiagramBox } from "./DiagramBox";
import { DiagramNote } from "./DiagramNote";
import { DiagramSvg } from "./DiagramSvg";

const m = "layering-arrow";
const boxes: [number, number, string, string][] = [
  [20, 170, "cli · expo · metro", "integrations"],
  [210, 190, "host-expo · host-nitro", "target SDK"],
  [420, 250, "backend-swift · backend-kotlin", "IR → source"],
  [690, 95, "compiler", "pure"],
  [805, 90, "oxc-parser", "TS syntax"],
];

/** Package layering: integrations → hosts → backends → compiler → parser. */
export function LayeringDiagram() {
  return (
    <DiagramSvg viewBox="0 0 900 110" markerId={m} title="Package layering: dependencies point one way toward the pure compiler">
      {boxes.map(([x, w, label, sub]) => (
        <DiagramBox key={label} x={x} y={24} w={w} label={label} sub={sub} accent={label === "compiler"} />
      ))}
      {boxes.slice(0, -1).map(([x, w], i) => (
        <DiagramArrow key={x} from={[x + w, 46]} to={[boxes[i + 1]![0], 46]} marker={m} />
      ))}
      <DiagramNote x={20} y={92} lines={["Arrows are imports. Nothing points left."]} />
    </DiagramSvg>
  );
}
