import { DiagramArrow } from "./DiagramArrow";
import { DiagramBox } from "./DiagramBox";
import { DiagramNote } from "./DiagramNote";
import { DiagramSvg } from "./DiagramSvg";

const m = "build-arrow";

/** Where Lucent runs inside the app's build: native generation and Metro. */
export function BuildDiagram() {
  return (
    <DiagramSvg
      viewBox="0 0 900 300"
      markerId={m}
      title="Where Lucent runs inside an app build: native generation and the Metro transformer"
    >
      <DiagramBox x={20} y={118} w={190} label="src/*.lucent.ts(x)" sub="one module per file" accent />

      <DiagramBox x={290} y={40} w={220} label="lucent build" sub="or the Expo prebuild plugin" />
      <DiagramBox x={550} y={40} w={150} label="native package" sub="modules/lucent · .lucent/nitro" />
      <DiagramBox x={740} y={40} w={140} label="Xcode · Gradle" sub="autolinked" />
      <DiagramArrow from={[210, 140]} to={[290, 62]} marker={m} />
      <DiagramArrow from={[510, 62]} to={[550, 62]} marker={m} />
      <DiagramArrow from={[700, 62]} to={[740, 62]} marker={m} />
      <DiagramNote
        x={290}
        y={106}
        lines={["Runs when native code changes. Cached per module by", "hash of source + compiler version + host."]}
      />

      <DiagramBox x={290} y={200} w={220} label="Metro transformer" sub="@lucent-lang/core/metro" />
      <DiagramBox x={550} y={200} w={150} label="JS proxy" sub="replaces the source" />
      <DiagramBox x={740} y={200} w={140} label="app bundle" sub="Hermes" />
      <DiagramArrow from={[210, 140]} to={[290, 222]} marker={m} />
      <DiagramArrow from={[510, 222]} to={[550, 222]} marker={m} />
      <DiagramArrow from={[700, 222]} to={[740, 222]} marker={m} />
      <DiagramNote
        x={290}
        y={266}
        lines={["Runs at bundle time. Only the proxy ships in JavaScript;", "the native module is looked up by name."]}
      />
    </DiagramSvg>
  );
}
