// The website's sample checker (scripts/website): a page's Lucent samples
// compile as one app. A page showing components drawn with SwiftUI and
// Compose compiles its samples with views generated, a one-file
// component's `.lucent.tsx` too.
import { describe, expect, it } from "vite-plus/test";
import { sdkAvailable } from "../../../packages/compiler/src/index.ts";
import { compileSamples } from "../../../scripts/website/compile.ts";
import { unbuiltProblems } from "../../../scripts/website/samples.ts";

/** The component the blog shows: a like button, one file for both platforms. */
const LIKE = `import { PLATFORM } from "lucent:platform";
import { Animation, Color, Font, HStack, Image, Text } from "lucent:swiftui";
import { Alignment, animateFloatAsState, Color as CColor, Modifier, Row, spring, Spring, Text as CText } from "lucent:compose";
import { signal } from "lucent:ui";

export function Like(props: { count: number }) {
  const liked = signal(false);                      // shared logic, written once
  const toggle = () => liked.set(!liked.get());
  const count = () => props.count + (liked.get() ? 1 : 0);

  if (PLATFORM === "ios") {
    return (
      <HStack spacing={6} onTapGesture={toggle}>
        <Image systemName={liked.get() ? "heart.fill" : "heart"} foregroundStyle={liked.get() ? Color.pink : Color.gray}
               scaleEffect={liked.get() ? 1.3 : 1}
               animation={[Animation.spring({ response: 0.3, dampingFraction: 0.4 }), { value: liked.get() }]} />
        <Text font={Font.headline}>{\`\${count()}\`}</Text>
      </HStack>
    );
  }

  const pop = animateFloatAsState(liked.get() ? 1.3 : 1, spring({ dampingRatio: Spring.DampingRatioHighBouncy }));
  return (
    <Row verticalAlignment={Alignment.CenterVertically} modifier={Modifier.clickable(toggle)}>
      <CText text={liked.get() ? "♥" : "♡"} color={liked.get() ? CColor(0xffe91e63) : CColor.Gray} modifier={Modifier.scale(pop.value)} />
      <CText text={\`\${count()}\`} />
    </Row>
  );
}
`;

describe("the website's samples", () => {
  it.skipIf(!sdkAvailable("android"))(
    "compile a one-file view component on a views page",
    () => {
      const { diagnostics } = compileSamples(
        "views-sample",
        [{ filename: "like.lucent.tsx", code: LIKE }],
        {
          views: true,
        },
      );

      expect(diagnostics).toEqual([]);
    },
    600_000,
  );
});

describe("C++ this machine can't rebuild", () => {
  const unbuilt = new Map([
    ["/docs/guides/call-an-ios-api/", { platforms: ["ios"], samples: ["battery.lucent.ts"] }],
  ]);

  it("is fine while the committed C++ covers every sample", () => {
    expect(unbuiltProblems(unbuilt, () => ({ "battery.lucent.ts": [] }))).toEqual([]);
  });

  it("is a problem when a page's C++ is missing or lacks a sample", () => {
    const problem = [
      '/docs/guides/call-an-ios-api/: its "See the C++" for battery.lucent.ts isn\'t built: run `node scripts/website.ts` where the ios SDK is installed',
    ];

    expect(unbuiltProblems(unbuilt, () => undefined)).toEqual(problem);
    expect(unbuiltProblems(unbuilt, () => ({ "device.lucent.ts": [] }))).toEqual(problem);
  });
});
