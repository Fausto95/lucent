/**
 * What the setup computes for a toolkit body is the setup's code to the
 * analyses (T123): each value a SwiftUI or Compose body shows that reads
 * the setup's names, and each a helper view computes where it is used,
 * runs in C++ on the main thread, so what it calls is checked as setup
 * code is (LUCENT3022). Compose bodies, built against stand-ins for
 * android.jar where the Android SDK is missing; the analysis is the same
 * for SwiftUI's.
 */
import { describe, expect, it } from "vite-plus/test";
import { build, composeBuilds, diagnostics } from "./toolkit-build.ts";

/** Module state JavaScript writes (`bump` runs off the main thread), and a function reading it. */
const COUNTER = `let count = 0;

export function bump(): number {
  count++;
  return count;
}

export function shown(): string {
  return \`\${count}\`;
}
`;

/** A Compose component `Screen` whose Android code is `code`, with COUNTER beside it. */
function component(code: string): Record<string, string> {
  return {
    "counter.lucent.ts": COUNTER,
    "screen.lucent.ts": `import type { View } from "lucent:android/android.view";

export type Props = { title: string; onPick?: (label: string) => void };

export declare function Screen(props: Props): View;
`,
    "screen.android.lucent.tsx": `import { BasicText, Column, Modifier } from "lucent:compose";
import { shown } from "./counter.lucent";
import type { Props } from "./screen.lucent";

${code}
`,
  };
}

const RACE =
  /^LUCENT3022 `Screen` cannot run on the main thread: .*calls `shown` .*, which reads module state `count`/;

describe.skipIf(!composeBuilds())("a toolkit body's values, as setup code", () => {
  it("check what a body value calls", () => {
    const { result } = build(
      component(`export function Screen(props: Props) {
  return (
    <Column>
      <BasicText text={props.title} />
      <BasicText text={shown()} />
    </Column>
  );
}`),
      "android",
    );

    expect(diagnostics(result)).toContainEqual(expect.stringMatching(RACE));
  });

  it("check what a callback passes to the setup function it calls", () => {
    const { result } = build(
      component(`export function Screen(props: Props) {
  const pick = (label: string) => {
    props.onPick?.(label);
  };

  return (
    <Column>
      <BasicText text={props.title} modifier={Modifier.clickable(() => pick(shown()))} />
    </Column>
  );
}`),
      "android",
    );

    expect(diagnostics(result)).toContainEqual(expect.stringMatching(RACE));
  });

  it("check what a helper view computes where it is used", () => {
    const { result } = build(
      component(`function Line(props: { label: string }) {
  return <BasicText text={\`\${props.label}: \${shown()}\`} />;
}

export function Screen(props: Props) {
  return (
    <Column>
      <Line label={props.title} />
    </Column>
  );
}`),
      "android",
    );

    expect(diagnostics(result)).toContainEqual(expect.stringMatching(RACE));
  });

  it("accept module state the main thread alone uses, and leave the toolkit's code out", () => {
    const { result } = build(
      {
        ...component(`let taps = 0;

export function Screen(props: Props) {
  const tap = () => {
    taps++;
  };

  return (
    <Column>
      <BasicText text={\`\${props.title} \${taps}\`} modifier={Modifier.clickable(tap)} />
    </Column>
  );
}`),
      },
      "android",
    );

    expect(diagnostics(result)).toEqual([]);
  });
});
