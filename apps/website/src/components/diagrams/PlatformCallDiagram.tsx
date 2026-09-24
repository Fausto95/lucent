import { DiagramArrow } from "./DiagramArrow";
import { DiagramBox } from "./DiagramBox";
import { DiagramLane } from "./DiagramLane";
import { DiagramNote } from "./DiagramNote";
import { DiagramSvg } from "./DiagramSvg";

const m = "platform-call-arrow";
const cols = [20, 230] as const;
const w = 190;

/** One SDK call in a module, and what each platform's build turns it into. */
export function PlatformCallDiagram() {
  return (
    <DiagramSvg
      viewBox="0 0 440 330"
      markerId={m}
      title="An SDK call compiles to an Objective-C message send on iOS and a JNI call on Android"
    >
      <DiagramBox x={95} y={14} w={250} label="device.lucent.ts" sub="one module" />
      <DiagramBox
        x={cols[0]}
        y={84}
        w={w}
        label="UIDevice.current.model"
        sub="the iOS branch"
        accent
      />
      <DiagramBox x={cols[1]} y={84} w={w} label="Build.MODEL" sub="the Android branch" accent />
      <DiagramArrow from={[cols[0] + w / 2, 58]} to={[cols[0] + w / 2, 84]} marker={m} />
      <DiagramArrow from={[cols[1] + w / 2, 58]} to={[cols[1] + w / 2, 84]} marker={m} />
      <DiagramLane x={10} y={140} w={w + 20} h={140} label="IOS" />
      <DiagramLane x={220} y={140} w={w + 20} h={140} label="ANDROID" />
      <DiagramBox x={cols[0]} y={168} w={w} label="message send" sub="[UIDevice currentDevice]" />
      <DiagramBox x={cols[1]} y={168} w={w} label="JNI call" sub="GetStaticObjectField" />
      <DiagramBox x={cols[0]} y={228} w={w} label="UIKit" sub="from your Xcode" />
      <DiagramBox x={cols[1]} y={228} w={w} label="android.os.Build" sub="from your Android SDK" />
      <DiagramArrow from={[cols[0] + w / 2, 128]} to={[cols[0] + w / 2, 168]} marker={m} />
      <DiagramArrow from={[cols[1] + w / 2, 128]} to={[cols[1] + w / 2, 168]} marker={m} />
      <DiagramArrow from={[cols[0] + w / 2, 212]} to={[cols[0] + w / 2, 228]} marker={m} />
      <DiagramArrow from={[cols[1] + w / 2, 212]} to={[cols[1] + w / 2, 228]} marker={m} />
      <DiagramNote
        x={20}
        y={306}
        lines={["Types come from the SDKs on your machine,", "read on first import and cached."]}
      />
    </DiagramSvg>
  );
}
