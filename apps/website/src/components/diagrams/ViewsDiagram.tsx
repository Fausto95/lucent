import { DiagramArrow } from "./DiagramArrow";
import { DiagramBox } from "./DiagramBox";
import { DiagramLabel } from "./DiagramLabel";
import { DiagramNote } from "./DiagramNote";
import { DiagramSvg } from "./DiagramSvg";

const m = "views-arrow";

/** A .lucent.tsx component rendered by SwiftUI and Compose, with props down and events up. */
export function ViewsDiagram() {
  return (
    <DiagramSvg
      viewBox="0 0 900 300"
      markerId={m}
      title="A native view: React owns state, the compiled render function produces SwiftUI and Compose"
    >
      <DiagramBox x={20} y={118} w={230} label="App.tsx" sub="<Card title={…} onPress={…} />" />
      <DiagramBox x={330} y={118} w={230} label="card.lucent.tsx" sub="Card(props): NativeView" accent />
      <DiagramBox x={640} y={40} w={240} label="iOS · SwiftUI" sub="VStack { Text; Button }" />
      <DiagramBox x={640} y={196} w={240} label="Android · Compose" sub="Column { Text; Button }" />

      <DiagramArrow from={[250, 128]} to={[330, 128]} marker={m} />
      <DiagramLabel x={290} y={120} text="props" />
      <DiagramArrow from={[330, 152]} to={[250, 152]} marker={m} dashed />
      <DiagramLabel x={290} y={168} text="Event<T>" />

      <DiagramArrow from={[560, 130]} to={[640, 72]} marker={m} />
      <DiagramArrow from={[560, 150]} to={[640, 208]} marker={m} />

      <DiagramNote x={20} y={186} lines={["State and effects stay in React.", "Layout props apply to the host view."]} />
      <DiagramNote
        x={330}
        y={186}
        lines={["Pure, synchronous render function.", "Compiled ahead of time; no JS on the", "native side."]}
      />
      <DiagramNote x={640} y={266} lines={["Hosted by an Expo view or a Nitro Fabric view."]} />
    </DiagramSvg>
  );
}
