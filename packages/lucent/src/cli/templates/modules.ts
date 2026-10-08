/**
 * Starter modules: what `lucent new module --template <t>` writes in an app's
 * src/, and the sample modules `lucent create` puts in the apps and the
 * library it scaffolds. Each compiles as it is written (create.test.ts
 * builds every one).
 */

export const MODULE_TEMPLATES = ["function", "async", "events", "view", "sdk-ios-android"] as const;
export type ModuleTemplate = (typeof MODULE_TEMPLATES)[number];

/** What each template is, for the picker and the docs. */
export const MODULE_TEMPLATE_SUMMARIES: Record<ModuleTemplate, string> = {
  function: "a function JavaScript calls synchronously",
  async: "an async function, with lucent:core's delay and an AbortSignal",
  events: "a stream of events to a JavaScript callback, stopped by an AbortSignal",
  view: "a component of native views, rendered by React (needs both SDKs to build)",
  "sdk-ios-android": "one module calling UIKit on iOS and android.os on Android",
};

export interface StarterModule {
  /** Files by path relative to the project. */
  files: Record<string, string>;
  /** The import that uses it, from the project's root. */
  import: string;
}

/** `user-card` or `userCard` → `UserCard`, a component's name. */
export const pascalCase = (name: string) =>
  name.replace(/(^|[-_\s]+)([a-zA-Z0-9])/g, (_, _sep, c: string) => c.toUpperCase());

/** A module whose branch for each platform calls that platform's SDK (`fn`: the export). */
export function platformSource(name: string, wanted: readonly ("ios" | "android")[], fn = "hello") {
  const ios = wanted.includes("ios");
  const android = wanted.includes("android");
  const imports = [
    'import { PLATFORM } from "lucent:platform";',
    ...(ios
      ? ['import { UIDevice } from "lucent:ios/UIKit";', 'import { main } from "lucent:thread";']
      : []),
    ...(android ? ['import { Build_VERSION } from "lucent:android/android.os";'] : []),
    ...(ios && android ? [] : ['import { error } from "lucent:core";']),
  ];
  const unimplemented = (label: string) =>
    `    throw error("ERR_UNIMPLEMENTED", "${fn} is not implemented on ${label} yet");`;
  return `// Runs natively on each platform; JavaScript imports it from "./src/${name}.lucent".
${imports.join("\n")}

export async function ${fn}(name: string): Promise<string> {
  if (PLATFORM === "ios") {
${
  ios
    ? `    // UIKit's UIDevice is main-thread only: main() runs it there.
    const system = await main(() => UIDevice.current.systemName);
    return \`Hello, \${name}, from \${system}\`;`
    : unimplemented("iOS")
}
  } else {
${android ? '    return `Hello, ${name}, from Android ${Build_VERSION.RELEASE ?? ""}`;' : unimplemented("Android")}
  }
}
`;
}

/**
 * The starter module `template` named `name` (the file's name, so the
 * module's): its files and how JavaScript imports it. `fn` names the
 * function templates' export.
 */
export function starterModule(template: ModuleTemplate, name: string, fn = "hello"): StarterModule {
  const file = (ext = "ts") => `src/${name}.lucent.${ext}`;
  const imports = (names: string[]) =>
    `import { ${names.join(", ")} } from "./src/${name}.lucent";`;

  switch (template) {
    case "function":
      return {
        files: {
          [file()]: `// Runs as C++; JavaScript imports it from "./src/${name}.lucent" and calls it synchronously.
export function ${fn}(name: string): string {
  return \`Hello, \${name}, from native code\`;
}
`,
        },
        import: imports([fn]),
      };

    case "async":
      return {
        files: {
          [file()]: `// Runs as C++, off the JavaScript thread while it awaits; JavaScript gets a Promise.
import { delay } from "lucent:core";

/** Greets \`name\` after \`ms\` milliseconds, unless \`signal\` aborts first. */
export async function ${fn}(name: string, ms: number, signal?: AbortSignal): Promise<string> {
  await delay(ms, signal);
  return \`Hello, \${name}, \${ms} ms later\`;
}
`,
        },
        import: imports([fn]),
      };

    case "events":
      return {
        files: {
          [file()]: `// Streams events to JavaScript: watch() calls its callback on each tick until the signal aborts.
//
//   const controller = new AbortController();
//   watch((tick) => console.log(tick.count), controller.signal);
//   start(5, 1000);
import { delay, subscribe } from "lucent:core";

export type Tick = { count: number };

const listeners = new Map<number, (tick: Tick) => void>();
let nextId = 0;

/** Ticks \`times\` times, every \`ms\` milliseconds, to every watcher. */
export async function start(times: number, ms: number): Promise<void> {
  for (let count = 1; count <= times; count++) {
    await delay(ms);
    for (const listener of listeners.values()) listener({ count });
  }
}

/** Sends each tick to \`onTick\`, until \`signal\` aborts. */
export async function watch(onTick: (tick: Tick) => void, signal: AbortSignal): Promise<void> {
  await subscribe<Tick>(
    (next) => {
      const id = nextId++;
      listeners.set(id, next);
      return () => {
        listeners.delete(id);
      };
    },
    onTick,
    signal,
  );
}
`,
        },
        import: imports(["start", "watch"]),
      };

    case "view": {
      const component = pascalCase(name);
      return {
        files: {
          [file("tsx")]:
            `// A component React renders, <${component} label="…" />, made of each platform's native view.
import { PLATFORM } from "lucent:platform";
import { appContext } from "lucent:android";
import { TextView } from "lucent:android/android.widget";
import { UILabel } from "lucent:ios/UIKit";
import { effect } from "lucent:ui";

export function ${component}(props: { label: string }) {
  if (PLATFORM === "ios") {
    const label = new UILabel();
    // Runs again whenever props.label changes.
    effect(() => {
      label.text = props.label;
    });
    return label;
  }

  const text = new TextView(appContext());
  effect(() => text.setText(props.label));
  return text;
}
`,
        },
        import: imports([component]),
      };
    }

    case "sdk-ios-android":
      return {
        files: { [file()]: platformSource(name, ["ios", "android"], fn) },
        import: imports([fn]),
      };
  }
}
