import type { Block } from "../../docs/types";

export const blocks: Block[] = [
  {
    kind: "p",
    text: "Lucent started as a way to write React Native's native modules in TypeScript. A `.lucent.ts` file compiles to C++, and your app calls it over JSI. The same compiler can now build native **views**.",
  },
  {
    kind: "p",
    text: "A component written in Lucent renders a real platform view in React Native's Fabric renderer. That view can be a UIKit or Android `View`, or a SwiftUI or Jetpack Compose body written in JSX.",
  },
  {
    kind: "p",
    text: "This is experimental. It's behind an internal switch (`LUCENT_VIEWS=fabric`), its APIs will change, and it hasn't run on physical devices yet. Here's what works today.",
  },

  { kind: "h2", text: "One component, each platform's own UI" },
  {
    kind: "p",
    text: "A component is one `.lucent.tsx` file. Its logic is written once; its view is written twice, in each platform's own UI toolkit, and `PLATFORM` picks which one each platform compiles:",
  },
  {
    kind: "code",
    filename: "like.lucent.tsx",
    code: `import { PLATFORM } from "lucent:platform";
import { signal } from "lucent:ui";
import { Animation, Color, Font, HStack, Image, Text } from "lucent:swiftui";
import {
  Alignment, Arrangement, Color as CColor, FontWeight, Modifier, Row,
  Spring, Text as CText, animateFloatAsState, dp, sp, spring,
} from "lucent:compose";

export function Like(props: { count: number }) {
  const liked = signal(false);
  const toggle = () => liked.set(!liked.get());
  const count = () => props.count + (liked.get() ? 1 : 0);

  if (PLATFORM === "ios") {
    return (
      <HStack spacing={6} onTapGesture={toggle}>
        <Image
          systemName={liked.get() ? "heart.fill" : "heart"}
          foregroundStyle={liked.get() ? Color.pink : Color.gray}
          scaleEffect={liked.get() ? 1.3 : 1}
          animation={[
            Animation.spring({ response: 0.3, dampingFraction: 0.4 }),
            { value: liked.get() },
          ]}
        />
        <Text font={Font.headline}>{\`\${count()}\`}</Text>
      </HStack>
    );
  }

  const pop = animateFloatAsState(
    liked.get() ? 1.3 : 1,
    spring({ dampingRatio: Spring.DampingRatioHighBouncy }),
  );

  return (
    <Row
      horizontalArrangement={Arrangement.spacedBy(dp(8))}
      verticalAlignment={Alignment.CenterVertically}
      modifier={Modifier.clickable(toggle)}
    >
      <CText
        text={liked.get() ? "♥︎" : "♡"}
        color={liked.get() ? CColor(0xffff2d55) : CColor.Gray}
        fontSize={sp(24)}
        modifier={Modifier.scale(pop.value)}
      />
      <CText text={\`\${count()}\`} fontSize={sp(17)} fontWeight={FontWeight.Bold} />
    </Row>
  );
}`,
  },
  { kind: "p", text: "React imports it once, like any component:" },
  {
    kind: "code",
    filename: "App.tsx",
    code: `import { Like } from "./like.lucent";

<Like count={41} />;`,
  },
  {
    kind: "p",
    text: "The iOS branch is SwiftUI and the Android branch is Jetpack Compose, each with the platform's own names: `HStack`, `scaleEffect` and `Animation.spring` on iOS; `Row`, `Modifier` and `animateFloatAsState` on Android. There's no shared component vocabulary to learn and no lowest common denominator. If Apple or Google document it, you write it the way they do. (A component can also be split into `like.ios.lucent.tsx` and `like.android.lucent.tsx` if you prefer.)",
  },

  { kind: "h2", text: "What the compiler does with it" },
  { kind: "p", text: "Each platform's build splits the component in two:" },
  {
    kind: "list",
    items: [
      "**The body**, the JSX it returns, becomes the platform's own source: a Swift `View` struct or a Kotlin `@Composable` function. It's compiled with the rest of the app.",
      "**The logic** — signals, event handlers, effects, timers, commands — compiles to C++, like any Lucent module, and runs on the main thread.",
    ],
  },
  {
    kind: "p",
    text: "The two meet at a narrow seam. A value the body reads from the logic, such as `liked.get()`, is computed in C++. It's pushed into the view's observable state: `@Published` in Swift, snapshot state in Compose.",
  },
  {
    kind: "p",
    text: "A function the body calls, such as `toggle`, runs the Lucent code and updates that state. SwiftUI and Compose then do what they always do: diff, animate and lay out.",
  },
  {
    kind: "p",
    text: "SwiftUI attributes follow a simple rule. An attribute named like one of the view's initializer labels is an argument (`systemName`). Every other attribute is a modifier, applied in the order you write it.",
  },
  {
    kind: "p",
    text: "A modifier you need twice chains after the element: `(<Text padding={8} />).padding(4)`.",
  },
  {
    kind: "p",
    text: "In Compose, calls that must run during composition (`animateFloatAsState`, `remember`, `LaunchedEffect`) stay plain statements in the component. The compiler recognizes them and moves them into the generated composable.",
  },

  { kind: "h2", text: "The declarations come from the SDKs" },
  {
    kind: "p",
    text: "`lucent:swiftui` is generated from the SwiftUI interface in your installed Xcode. `lucent:compose` is generated from the Kotlin metadata of Compose's libraries, including Material 3.",
  },
  {
    kind: "p",
    text: "Neither is a hand-written list: an API is available because the SDK declares it, with its real parameter names. An API Lucent can't express yet comes with the reason. The same holds for UIKit, Foundation and the Android SDK.",
  },

  { kind: "h2", text: "Views that keep moving while JavaScript is busy" },
  {
    kind: "p",
    text: "The UI runs on the main thread and never waits for JavaScript. In our tests on the iOS simulator and Android emulator, a native timer kept flipping and animating a toggle through a 3-second JavaScript block. JavaScript heard about each flip when it was free again.",
  },
  {
    kind: "p",
    text: "Events, commands, requests that answer with a value, view recycling, sizing to content, and React children in a native container work on both platforms.",
  },

  { kind: "h2", text: "Try it, carefully" },
  {
    kind: "p",
    text: "Views are off unless you set `LUCENT_VIEWS=fabric`. Expect changes, and don't ship them yet. The next steps are physical devices, performance budgets, and more of each toolkit, such as container helpers and lists inside helper views.",
  },
  {
    kind: "p",
    text: "The rest of Lucent (writing native modules in TypeScript) is covered in the [docs](/docs/).",
  },
];
