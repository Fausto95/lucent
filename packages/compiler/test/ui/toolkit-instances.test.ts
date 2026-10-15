/**
 * Instance props in SwiftUI and Compose bodies (T123, decisions 0121 and
 * 0122): the instance stays in C++. The body shows what the setup
 * computes from it (a member's value, a method's result), read on the
 * main thread when its prop changes, and setup functions call its
 * methods. A list of instances shows what the setup computes for each. The members a
 * body's values use are checked as setup code's are (decision 0098).
 * Compose bodies, built against stand-ins for android.jar where the
 * Android SDK is missing; SwiftUI's take the same path.
 */
import { describe, expect, it } from "vite-plus/test";
import { glueErrors, jdk } from "../jni-harness.ts";
import { build, composeBuilds, diagnostics, generated } from "./toolkit-build.ts";

const PLAYER = `export class Player {
  private counted = 0;

  constructor(readonly title: string) {}

  /** A method reading a member nothing writes once made. */
  label(): string {
    return \`#\${this.title}\`;
  }

  /** What a setup function calls on a tap. */
  play(): void {}

  /** Counts on whichever thread runs it: JavaScript may call it too. */
  count(): number {
    return ++this.counted;
  }
}
`;

/** A Compose component `Screen` taking a player, whose setup's code is `code`. */
function component(code: string): Record<string, string> {
  return {
    "player.lucent.ts": PLAYER,
    "screen.lucent.ts": `import type { View } from "lucent:android/android.view";
import type { Player } from "./player.lucent";

export type Props = {
  player: Player;
  next: Player | null;
  players: Player[];
  onPicked?: (title: string) => void;
};

export declare function Screen(props: Props): View;
`,
    "screen.android.lucent.tsx": `import { BasicText, Column, LazyColumn, Modifier } from "lucent:compose";
import type { Player } from "./player.lucent";
import type { Props } from "./screen.lucent";

export function Screen(props: Props) {
${code}
}
`,
  };
}

describe.skipIf(!composeBuilds())("an instance prop in a Compose body", () => {
  it("stays in C++: the body shows what the setup computes from it", () => {
    const { result } = build(
      component(`  const pick = () => {
    props.onPicked?.(props.player.label());
  };

  return (
    <Column>
      <BasicText text={props.player.title} modifier={Modifier.clickable(pick)} />
      <BasicText text={props.player.label()} />
      <BasicText text={props.next?.title ?? "none"} />
    </Column>
  );`),
      "android",
    );

    expect(diagnostics(result)).toEqual([]);

    const glue = generated(result, /^android\/m_screen\.cpp$/);

    expect(glue).toMatch(/= props\.p0_player\.get\(\);\s+(#line \d+\s+)?return v\d+_->title;/);
    expect(glue).toMatch(/= props\.p0_player\.get\(\);\s+(#line \d+\s+)?return v\d+_->label\(\);/);
    expect(glue).toContain("lucent::Opt<lucent::Ref<lucent_app::C_Player>>");
    // The Kotlin holds the values, never the instance.
    expect(generated(result, /^dev\/lucent\/compose\/.*\.kt$/)).not.toContain("Player");
  });

  it("checks the members its values use", () => {
    const { result } = build(
      component(`  return (
    <Column>
      <BasicText text={\`\${props.player.count()}\`} />
    </Column>
  );`),
      "android",
    );

    expect(diagnostics(result)).toContainEqual(
      expect.stringMatching(
        /^LUCENT3022 `Screen` cannot run on the main thread: it calls `props\.player\.count` .*, which writes `Player\.counted`/,
      ),
    );
  });

  it("shows a list of instances: each item's values computed from its instance, its actions given it", () => {
    const built = build(
      component(`  const pick = (p: Player) => {
    props.onPicked?.(p.label());
  };

  return (
    <LazyColumn>
      {(list) => (
        <list.items items={props.players} key={(p) => p.title}>
          {(_, p) => <BasicText text={p.label()} modifier={Modifier.clickable(() => pick(p))} />}
        </list.items>
      )}
    </LazyColumn>
  );`),
      "android",
    );

    expect(diagnostics(built.result)).toEqual([]);

    const glue = generated(built.result, /^android\/m_screen\.cpp$/);

    // The items stay in C++, found again by their keys for the actions.
    expect(glue).toContain("lucent::ui::Items<lucent::String, lucent::Ref<lucent_app::C_Player>>");
    expect(glue).toMatch(/return p0_->label\(\);/);
    expect(generated(built.result, /^dev\/lucent\/compose\/.*\.kt$/)).toContain(
      "Modifier.clickable { lucent.pick1(lucent_item.key) }",
    );
    // The glue compiles on the host, against the JDK's jni.h.
    expect(jdk ? glueErrors(built.result, built.dir, "android/m_screen.cpp") : "").toBe("");
  });

  it("checks the members a list's item uses", () => {
    const { result } = build(
      component(`  return (
    <LazyColumn>
      {(list) => (
        <list.items items={props.players} key={(p) => p.title}>
          {(_, p) => <BasicText text={\`\${p.count()}\`} />}
        </list.items>
      )}
    </LazyColumn>
  );`),
      "android",
    );

    expect(diagnostics(result)).toContainEqual(
      expect.stringMatching(
        /^LUCENT3022 `Screen` cannot run on the main thread: it calls `p\.count` .*, which writes `Player\.counted`/,
      ),
    );
  });

  it("refuses the body calling a method itself: setup functions do", () => {
    const { result } = build(
      component(`  return (
    <Column>
      <BasicText text={props.player.title} modifier={Modifier.clickable(() => props.player.play())} />
    </Column>
  );`),
      "android",
    );

    expect(diagnostics(result)).toContain(
      "LUCENT3024 the body calls `props.player.play`, a method of an instance: call it in a setup function the body calls, `const play = () => props.player.play()`",
    );
  });
});
