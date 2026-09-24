import type { Block } from "../types";

export const blocks: Block[] = [
  {
    kind: "table",
    head: ["Swift", "Kotlin", "Lucent"],
    rows: [
      [
        "`struct`",
        "`data class`",
        "an object type, `type Point = { x: number; y: number }`: copied at the boundary",
      ],
      ["`class`", "`class`", "`class`: reference-counted, as in Swift"],
      ["`protocol`", "`interface`", "`interface`, used with `implements`"],
      ["a delegate", "a listener", "a class that `implements` the SDK's protocol or interface"],
      ["`async`", "`suspend`", "`async`: runs on the Lucent thread"],
      ["`@MainActor`", "`Dispatchers.Main`", "`main(() => …)` from `lucent:thread`"],
      ["`T?`", "`T?`", "`T | null`"],
      [
        "`throws`",
        "exceptions",
        "`throw error(code, message)`; SDK errors arrive as errors with a `code`",
      ],
      [
        "`if #available(iOS 17, *)`",
        "`Build.VERSION.SDK_INT >= 34`",
        '`available("ios", 17)`, `available("android", 34)`',
      ],
      ["`enum`", "`enum class`", "`enum`"],
    ],
  },
  {
    kind: "p",
    text: "SDK names stay as you know them: Swift's names on iOS (`UIDevice.current`), Java's on Android (`Build.MODEL`). Nested types join with `_`, as in `UIImpactFeedbackGenerator_FeedbackStyle` and `Build_VERSION`.",
  },
  { kind: "h2", text: "One module instead of three files" },
  {
    kind: "p",
    text: "An Expo module of the clipboard needs Swift, Kotlin and a JavaScript binding. This is a short version of each, in the Expo Modules API:",
  },
  {
    kind: "tabs",
    tabs: [
      {
        label: "Swift",
        filename: "ClipboardModule.swift",
        code: `import ExpoModulesCore

public class ClipboardModule: Module {
  public func definition() -> ModuleDefinition {
    Name("Clipboard")

    AsyncFunction("getStringAsync") { () -> String in
      UIPasteboard.general.string ?? ""
    }.runOnQueue(.main)

    AsyncFunction("setStringAsync") { (text: String) in
      UIPasteboard.general.string = text
    }.runOnQueue(.main)
  }
}`,
      },
      {
        label: "Kotlin",
        filename: "ClipboardModule.kt",
        code: `class ClipboardModule : Module() {
  private val clipboard
    get() = appContext.reactContext!!.getSystemService(ClipboardManager::class.java)

  override fun definition() = ModuleDefinition {
    Name("Clipboard")

    AsyncFunction("getStringAsync") {
      clipboard.primaryClip?.getItemAt(0)?.text?.toString() ?: ""
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("setStringAsync") { text: String ->
      clipboard.setPrimaryClip(ClipData.newPlainText(null, text))
    }.runOnQueue(Queues.MAIN)
  }
}`,
      },
      {
        label: "JS binding",
        filename: "index.ts",
        code: `import { requireNativeModule } from "expo-modules-core";

const Clipboard = requireNativeModule("Clipboard");

export const getStringAsync = (): Promise<string> => Clipboard.getStringAsync();
export const setStringAsync = (text: string): Promise<void> => Clipboard.setStringAsync(text);`,
      },
    ],
  },
  {
    kind: "p",
    text: "The Lucent module does the same in one file, and JavaScript imports it directly:",
  },
  {
    kind: "code",
    filename: "clipboard.lucent.ts",
    cpp: true,
    code: `import { PLATFORM } from "lucent:platform";
import { UIPasteboard } from "lucent:ios/UIKit";
import { ClipboardManager, ClipData } from "lucent:android/android.content";
import { appContext } from "lucent:android";
import { main } from "lucent:thread";

export async function getStringAsync(): Promise<string> {
  if (PLATFORM === "ios") {
    return main(() => UIPasteboard.general.string ?? "");
  } else {
    return main(() => {
      const clip = appContext().getSystemService(ClipboardManager)?.getPrimaryClip();
      return clip?.getItemAt(0)?.getText() ?? "";
    });
  }
}

export async function setStringAsync(text: string): Promise<void> {
  if (PLATFORM === "ios") {
    await main(() => {
      UIPasteboard.general.string = text;
    });
  } else {
    await main(() => {
      const clip = ClipData.newPlainText(null, text);
      if (clip) appContext().getSystemService(ClipboardManager)?.setPrimaryClip(clip);
    });
  }
}`,
  },
  {
    kind: "list",
    items: [
      "The JS binding is gone: the module's exports are the API, typed from the source.",
      "`main()` replaces `runOnQueue`. APIs that Swift marks `@MainActor` compile only inside it.",
      "Kotlin's `!!` and `?.` become Lucent's `?.` and `??`, since unannotated Java references are nullable.",
    ],
  },
  {
    kind: "p",
    text: "The full port of `expo-clipboard` is in the [examples](/docs/examples/clipboard/).",
  },
];
