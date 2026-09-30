import type { Block } from "../../types";

export const blocks: Block[] = [
  { kind: "h2", text: "Read the error in JavaScript" },
  {
    kind: "code",
    filename: "terminal",
    copy: false,
    code: `Error: The config is empty
    at parseConfig (/Users/you/app/src/config.lucent.ts:6)
    at App (App.tsx:12)`,
  },
  {
    kind: "p",
    text: "An error made in Lucent, with `error()` or `new Error`, reaches JavaScript with its first stack frame at the `.lucent.ts` line that made it.",
  },
  { kind: "h2", text: "Read the logs" },
  {
    kind: "list",
    items: [
      "iOS: Console.app or Xcode's console, filtered on `[Lucent]`. `console.log` in a module writes there.",
      "Android: `adb logcat -s Lucent`.",
      "An error nothing catches, such as one thrown in an SDK callback, is logged as `[lucent] uncaught exception in …`.",
    ],
  },
  { kind: "h2", text: "Symbolicate a native crash" },
  {
    kind: "p",
    text: "The C++ carries `#line` directives, so its debug information points at your `.lucent.ts` files. With the app's dSYM on iOS, or its unstripped `.so` on Android, a crash report names the module's file and line. Xcode and Android Studio also step through `.lucent.ts` lines.",
  },
  { kind: "h2", text: "Check the setup" },
  { kind: "code", filename: "terminal", code: "npx lucent doctor" },
  {
    kind: "p",
    text: '`Lucent: the native module is not linked` means the app was built without the native package: run `lucent build`, then `pod install`, and rebuild. `module "x" is not in the native build` means the app is older than the module: rebuild it.',
  },
  {
    kind: "p",
    text: "Each proxy checks that the app's native code was built from the same sources as the JavaScript. When it wasn't, the error says what to do: rebuild and reinstall the app (`compile-native`), or reload JavaScript built for the installed app (`reload-js`). When only function bodies differ, it's a warning.",
  },
  {
    kind: "p",
    text: "A JavaScript update, a reload or an update over the air, can't replace native code.",
  },
];
