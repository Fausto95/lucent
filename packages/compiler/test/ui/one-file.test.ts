// One-file components: a shared `.lucent.tsx` file
// writes a component's logic once and its body with each platform's
// toolkit, SwiftUI's JSX in its iOS branch and Compose's in its Android
// branch. The file's JSX is typed by both toolkits; each platform's
// program compiles the setup with that platform's body, Compose's
// composition statements lifted from the Android code, and refuses a
// toolkit's code where its platform does not run.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { compile, type SdkOptions } from "../../src/index.ts";
import { jsxRuntimeOf } from "../../src/program.ts";
import {
  android,
  androidGlueErrors,
  build,
  composeCompiles,
  diagnostics,
  generated,
  ios,
  kotlinErrors,
  swiftErrors,
} from "./toolkit-build.ts";

/** The component the documentation shows: a like button, one file for both platforms. */
const LIKE = `import { PLATFORM } from "lucent:platform";
import { Animation, Color, Font, HStack, Image, Text } from "lucent:swiftui";
import {
  Alignment,
  animateFloatAsState,
  Color as CColor,
  Modifier,
  Row,
  spring,
  Spring,
  Text as CText,
} from "lucent:compose";
import { signal } from "lucent:ui";

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
          animation={[Animation.spring({ response: 0.3, dampingFraction: 0.4 }), { value: liked.get() }]}
        />
        <Text font={Font.headline}>{\`\${count()}\`}</Text>
      </HStack>
    );
  }

  const pop = animateFloatAsState(liked.get() ? 1.3 : 1, spring({ dampingRatio: Spring.DampingRatioHighBouncy }));
  return (
    <Row verticalAlignment={Alignment.CenterVertically} modifier={Modifier.clickable(toggle)}>
      <CText
        text={liked.get() ? "♥" : "♡"}
        color={liked.get() ? CColor(0xffe91e63) : CColor.Gray}
        modifier={Modifier.scale(pop.value)}
      />
      <CText text={\`\${count()}\`} />
    </Row>
  );
}
`;

/** A one-file module `like.lucent.tsx` whose code is `code`, with LIKE's imports. */
function module(code: string): Record<string, string> {
  return { "like.lucent.tsx": `${LIKE.slice(0, LIKE.indexOf("export function"))}${code}\n` };
}

const both = ios && android;

describe.skipIf(!both)("a one-file component", () => {
  it("imports its platform's toolkit for each file's JSX: one file's, both", () => {
    expect(jsxRuntimeOf("lucent:jsx/jsx-runtime", "/a/like.lucent.tsx")).toBe("lucent:jsx");
    expect(jsxRuntimeOf("lucent:jsx/jsx-runtime", "/a/like.ios.lucent.tsx")).toBe("lucent:swiftui");
  });

  it("writes SwiftUI on iOS, its logic in its setup", () => {
    const built = build({ "like.lucent.tsx": LIKE }, "ios");

    expect(diagnostics(built.result)).toEqual([]);

    const swift = generated(built.result, /^ios\/views\/.*\.swift$/);

    expect(swift).toContain("HStack(spacing: 6) {");
    expect(swift).toMatch(/\.onTapGesture \{ model\.actions\(0\) \}/);
    expect(swiftErrors(built)).toBe("");
    // Its glue calls the Swift side: an Objective-C++ unit, as a platform file's is.
    expect([...built.result.files.keys()]).toContain("ios/m_like.mm");
    expect(built.result.components?.[0]?.platforms.ios?.root).toEqual({
      module: "lucent:swiftui",
      name: "UIHostingController",
    });
  }, 300_000);

  it("writes Compose on Android, its composition statements lifted from its Android code", () => {
    const built = build({ "like.lucent.tsx": LIKE }, "android");

    expect(diagnostics(built.result)).toEqual([]);

    const kotlin = generated(built.result, /^dev\/lucent\/compose\/.*\.kt$/);

    expect(kotlin).toMatch(/val pop = animateFloatAsState\(/);
    expect(kotlin).toMatch(/Row\(verticalAlignment = Alignment\.CenterVertically/);
    expect(built.result.components?.[0]?.platforms.android?.root).toEqual({
      module: "lucent:compose",
      name: "ComposeView",
    });
  }, 600_000);

  it.skipIf(!composeCompiles())(
    "compiles its Android body as the app does",
    () => {
      const built = build({ "like.lucent.tsx": LIKE }, "android");

      expect(kotlinErrors(built)).toBe("");
      expect(androidGlueErrors(built)).toBe("");
    },
    600_000,
  );

  it("takes its Android body from a branch of its own too", () => {
    const code = `export function Like(props: { count: number }) {
  const liked = signal(false);

  if (PLATFORM === "android") {
    const pop = animateFloatAsState(liked.get() ? 1.3 : 1);

    return <CText text={\`\${props.count}\`} modifier={Modifier.scale(pop.value)} />;
  }

  return <Text>{\`\${props.count}\`}</Text>;
}`;

    expect(diagnostics(build(module(code), "ios").result)).toEqual([]);
    expect(diagnostics(build(module(code), "android").result)).toEqual([]);
  }, 600_000);

  it("keeps each toolkit's code in its platform's branch", () => {
    const refused = (code: string, platform: "ios" | "android") =>
      diagnostics(build(module(code), platform).result);

    // SwiftUI's view where Android runs.
    expect(
      refused(
        `export function Like(props: { count: number }) {
  if (PLATFORM === "ios") return <HStack />;

  return <Text>x</Text>;
}`,
        "android",
      ),
    ).toContainEqual(
      "LUCENT3024 `Text` is SwiftUI's (iOS): use it in the component's iOS code, inside `if (PLATFORM === \"ios\")`",
    );
    // A body outside any branch, in a file writing both toolkits.
    expect(
      refused(
        `export function Like(props: { count: number }) {
  return <HStack />;
}`,
        "ios",
      ),
    ).toContainEqual(
      "LUCENT3024 `HStack` is SwiftUI's (iOS): use it in the component's iOS code, inside `if (PLATFORM === \"ios\")`",
    );
    // A composition statement where iOS runs.
    expect(
      refused(
        `export function Like(props: { count: number }) {
  if (PLATFORM === "ios") {
    const pop = animateFloatAsState(1);

    return <HStack />;
  }

  return <Row />;
}`,
        "ios",
      ),
    ).toContainEqual(
      "LUCENT3024 `animateFloatAsState` is Compose's (Android): use it in the component's Android code, inside `if (PLATFORM === \"android\")`",
    );
  }, 600_000);

  it("is a component on every platform it compiles for", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-one-file-"));
    const file = path.join(dir, "like.lucent.tsx");

    fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "@acme/app" }));
    fs.writeFileSync(
      file,
      module(`export function Like(props: { count: number }) {
  if (PLATFORM === "ios") return <HStack />;

  return undefined;
}`)["like.lucent.tsx"]!,
    );

    try {
      const result = compile([file], { platforms: ["ios", "android"] });

      expect(diagnostics(result)).toContainEqual(
        "LUCENT3023 `Like` is a component on ios but not on android: return a view on every platform",
      );
    } finally {
    }
  }, 600_000);

  it("compiles for Android where the iOS SDK is missing, its iOS code untyped", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-one-file-"));
    const file = path.join(dir, "like.lucent.tsx");

    fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "@acme/app" }));
    fs.writeFileSync(file, LIKE);

    try {
      const result = compile([file], {
        platforms: ["android"],
        sdk: { ios: { xcrun: path.join(os.tmpdir(), "no-such-xcrun") } },
      });

      expect(diagnostics(result)).toEqual([]);
      expect(result.compose).toBe(true);
    } finally {
    }
  }, 600_000);

  it("keeps a helper view to its toolkit's platform", () => {
    const helpers = `function Heart(props: { on: boolean }) {
  return <Image systemName={props.on ? "heart.fill" : "heart"} />;
}

function Pop(props: { on: boolean }) {
  return <CText text={props.on ? "♥" : "♡"} />;
}

`;
    const good = module(`${helpers}export function Like(props: { count: number }) {
  const liked = signal(false);

  if (PLATFORM === "ios") return <Heart on={liked.get()} />;

  return <Pop on={liked.get()} />;
}`);

    expect(diagnostics(build(good, "ios").result)).toEqual([]);
    expect(diagnostics(build(good, "android").result)).toEqual([]);

    const bad = module(`${helpers}export function Like(props: { count: number }) {
  if (PLATFORM === "ios") return <Heart on />;

  return <Heart on />;
}`);

    expect(diagnostics(build(bad, "android").result)).toContainEqual(
      "LUCENT3024 `Heart` is SwiftUI's (iOS): use it in the component's iOS code, inside `if (PLATFORM === \"ios\")`",
    );
  }, 600_000);
});

/**
 * A component written with UIKit's and Android's own views, made in its
 * setup: the documentation's counter. Its iOS branch returns a UILabel,
 * its Android code a TextView.
 */
const COUNTER = `import { appContext } from "lucent:android";
import { TextView } from "lucent:android/android.widget";
import { UILabel } from "lucent:ios/UIKit";
import { PLATFORM } from "lucent:platform";
import { effect, signal } from "lucent:ui";

export function Counter(props: { label: string }) {
  const count = signal(0);

  if (PLATFORM === "ios") {
    const label = new UILabel();

    effect(() => {
      label.text = \`\${props.label}: \${count.get()}\`;
    });

    return label;
  }

  const text = new TextView(appContext());

  effect(() => {
    text.setText(\`\${props.label}: \${count.get()}\`);
  });

  return text;
}
`;

/** A component of each platform's views in platform files, behind a declaration file. */
const TITLE = {
  "title.lucent.ts": `import type { View } from "lucent:android/android.view";
import type { UIView } from "lucent:ios/UIKit";

export declare function Title(props: { title: string }): UIView | View;
`,
  "title.ios.lucent.tsx": `import { UILabel, type UIView } from "lucent:ios/UIKit";

export function Title(props: { title: string }): UIView {
  return <UILabel text={props.title} />;
}
`,
  "title.android.lucent.tsx": `import type { View } from "lucent:android/android.view";
import { TextView } from "lucent:android/android.widget";

export function Title(props: { title: string }): View {
  return <TextView text={props.title} />;
}
`,
};

/** Where each platform's SDK is not: a missing xcrun, an empty Android SDK root. */
const MISSING: Record<"ios" | "android", SdkOptions> = {
  ios: { ios: { xcrun: path.join(os.tmpdir(), "no-such-xcrun") } },
  android: { android: { sdkRoots: [path.join(os.tmpdir(), "no-such-android-sdk")] } },
};

/** `files` in a package `@acme/app`, compiled with views on for the default platforms, `missing`'s SDK absent. */
function buildWithout(files: Record<string, string>, missing: "ios" | "android") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `lucent-no-${missing}-sdk-`));

  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "@acme/app" }));
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), text);

  try {
    return compile(
      Object.keys(files).map((f) => path.join(dir, f)),
      { sdk: MISSING[missing] },
    );
  } finally {
  }
}

describe("a component whose other platform's SDK is missing", () => {
  it.skipIf(!android)(
    "compiles for Android alone, its UIKit view untyped and left out",
    () => {
      const result = buildWithout({ "counter.lucent.tsx": COUNTER }, "ios");
      const files = [...result.files.keys()];

      expect(diagnostics(result)).toEqual([]);
      expect(result.files.get("android/m_counter.cpp")).toContain("android/widget/TextView");
      expect(files.filter((f) => f.startsWith("ios/"))).toEqual([]);
      expect(Object.keys(result.components?.[0]?.platforms ?? {})).toEqual(["android"]);
      expect(result.components?.[0]?.platforms.android?.root).toEqual({
        module: "android.widget",
        name: "TextView",
      });
    },
    600_000,
  );

  it.skipIf(!ios)(
    "compiles for iOS alone, its Android view untyped and left out",
    () => {
      const result = buildWithout({ "counter.lucent.tsx": COUNTER }, "android");
      const files = [...result.files.keys()];

      expect(diagnostics(result)).toEqual([]);
      expect(files.some((f) => f.startsWith("ios/m_counter."))).toBe(true);
      expect(files.filter((f) => f.startsWith("android/"))).toEqual([]);
      expect(Object.keys(result.components?.[0]?.platforms ?? {})).toEqual(["ios"]);
      expect(result.components?.[0]?.platforms.ios?.root).toEqual({
        module: "UIKit",
        name: "UILabel",
      });
    },
    600_000,
  );

  it.skipIf(!android)(
    "compiles platform files for Android alone, the iOS file left out",
    () => {
      const result = buildWithout(TITLE, "ios");

      expect(diagnostics(result)).toEqual([]);
      expect([...result.files.keys()].filter((f) => f.startsWith("ios/"))).toEqual([]);
      expect(Object.keys(result.components?.[0]?.platforms ?? {})).toEqual(["android"]);
    },
    600_000,
  );

  it.skipIf(!ios)(
    "compiles platform files for iOS alone, the Android file left out",
    () => {
      const result = buildWithout(TITLE, "android");

      expect(diagnostics(result)).toEqual([]);
      expect([...result.files.keys()].filter((f) => f.startsWith("android/"))).toEqual([]);
      expect(Object.keys(result.components?.[0]?.platforms ?? {})).toEqual(["ios"]);
    },
    600_000,
  );
});

describe.skipIf(!both)("a component returning each platform's own view", () => {
  it("returns its platform's view from its setup, not a variant of both", () => {
    for (const platform of ["ios", "android"] as const) {
      const { result } = build({ "counter.lucent.tsx": COUNTER }, platform);
      const unit = generated(result, new RegExp(`^${platform}/m_counter\\.(cpp|mm)$`));

      expect(diagnostics(result)).toEqual([]);
      expect(unit).toContain("lucent::NativeRef m_counter::Counter_setup(");
      expect(unit).not.toContain("std::variant");
    }
  }, 600_000);
});
