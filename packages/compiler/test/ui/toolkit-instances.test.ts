/**
 * Instance props in SwiftUI and Compose bodies (T123, decision 0121): the
 * instance stays in C++. The body shows what the setup computes from it
 * (a member's value, a method's result), read on the main thread when
 * its prop changes, and setup functions call its methods. The members a
 * body's values use are checked as setup code's are (decision 0098).
 * Compose bodies, built against stand-ins for android.jar where the
 * Android SDK is missing; SwiftUI's take the same path.
 */
import { describe, expect, it } from "vite-plus/test";
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

  it("shows a list of instances as the plain data the setup maps them to", () => {
    const list = (items: string, key: string, text: string) =>
      build(
        component(`  const rows = () => props.players.map((p) => ({ title: p.title }));

  return (
    <LazyColumn>
      {(list) => (
        <list.items items={${items}} key={${key}}>
          {(_, item) => <BasicText text={${text}} />}
        </list.items>
      )}
    </LazyColumn>
  );`),
        "android",
      ).result;

    expect(diagnostics(list("rows()", "(r) => r.title", "item.title"))).toEqual([]);
    expect(diagnostics(list("props.players", "(p) => p.title", "item.title"))).toEqual([
      "LUCENT3024 a Compose list shows plain data, not instances, for now: show what a setup function maps `props.players` to (`const rows = () => props.players.map((x) => ({ … }))`)",
    ]);
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
