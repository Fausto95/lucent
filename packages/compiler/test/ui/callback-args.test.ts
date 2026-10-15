/**
 * What a SwiftUI or Compose callback passes to the setup function it
 * calls (T123): JavaScript evaluates a callback's arguments when it runs,
 * so what Lucent code computes (a prop, a module function's call, an
 * instance) is computed in C++ when the action runs, in order and in the
 * mount, never kept as a slot from when what it read last changed. What
 * the callback itself gives (its parameters, literals, a list's item)
 * crosses from Swift or Kotlin. Compose bodies, built against stand-ins
 * for android.jar where the Android SDK is missing; SwiftUI's take the
 * same path.
 */
import { describe, expect, it } from "vite-plus/test";
import { glueErrors, jdk } from "../jni-harness.ts";
import { build, composeBuilds, diagnostics, generated } from "./toolkit-build.ts";

const FILES = {
  "player.lucent.ts": `export class Player {
  constructor(readonly title: string) {}
}
`,
  "screen.lucent.ts": `import type { View } from "lucent:android/android.view";
import type { Player } from "./player.lucent";

export type Props = {
  title: string;
  player: Player;
  onPick?: (label: string, n: number) => void;
};

export declare function Screen(props: Props): View;
`,
  "screen.android.lucent.tsx": `import { BasicText, Column, Modifier } from "lucent:compose";
import { signal } from "lucent:ui";
import type { Player } from "./player.lucent";
import type { Props } from "./screen.lucent";

let taps = 0;

/** Counts taps: JavaScript would call it at each tap, never before. */
function tapped(): number {
  taps++;
  return taps;
}

export function Screen(props: Props) {
  const on = signal(false);
  const pick = (label: string, n: number) => {
    props.onPick?.(label, n);
  };
  const play = (p: Player) => {
    props.onPick?.(p.title, 0);
  };

  return (
    <Column>
      <BasicText text="a" modifier={Modifier.clickable(() => pick(props.title, tapped()))} />
      <BasicText text="b" modifier={Modifier.clickable(() => pick("b", 2))} />
      <BasicText text="c" modifier={Modifier.toggleable(on.get(), (v) => pick(props.title, v ? 1 : 0))} />
      <BasicText text="d" modifier={Modifier.clickable(() => play(props.player))} />
    </Column>
  );
}
`,
};

describe.skipIf(!composeBuilds())("a Compose callback's arguments", () => {
  it("are computed when the action runs, what the setup computes in C++", () => {
    const built = build(FILES, "android");

    expect(diagnostics(built.result)).toEqual([]);

    const kotlin = generated(built.result, /^dev\/lucent\/compose\/.*\.kt$/);

    // Kotlin gives what the callback has: nothing, a literal, its parameter.
    expect(kotlin).toMatch(/text = "a", modifier = Modifier\.clickable \{ lucent\.pick\d+\(\) \}/);
    expect(kotlin).toMatch(/Modifier\.clickable \{ lucent\.pick\d+\("b", 2\.0\) \}/);
    expect(kotlin).toMatch(/\{ v -> lucent\.pick\d+\(if \(v\) 1\.0 else 0\.0\) \}/);
    expect(kotlin).toMatch(/Modifier\.clickable \{ lucent\.play\d+\(\) \}/);
    // No slot keeps what tapped() returned: Kotlin holds no value of it.
    expect(kotlin).not.toContain("tapped");

    const glue = generated(built.result, /^android\/m_screen\.cpp$/);

    // In the mount, in order, then the call: C++ leaves a call's arguments unordered.
    expect(glue).toMatch(
      /lucent::ui::inContent\(lucent_content, \[f = pick, arg0 = v\d+_, arg1 = v\d+_\]\(\) mutable \{\s+(#line \d+\s+)?auto value0 = arg0\(\);\s+(#line \d+\s+)?auto value1 = arg1\(\);\s+(#line \d+\s+)?f\(value0, value1\);/,
    );
    expect(glue).toMatch(
      /\(double p0\) mutable \{\s+(#line \d+\s+)?auto value0 = arg0\(\);\s+(#line \d+\s+)?f\(value0, p0\);/,
    );
    // A literal's call takes the setup function as it is.
    expect(glue).toMatch(/setAction\(\d+, pick, /);
    // The glue compiles on the host, against the JDK's jni.h.
    expect(jdk ? glueErrors(built.result, built.dir, "android/m_screen.cpp") : "").toBe("");
  });
});
