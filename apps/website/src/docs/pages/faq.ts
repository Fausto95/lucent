import type { Block } from "../types";

const qa: [string, string][] = [
  [
    "Can I use Lucent in production?",
    "Not yet. It's experimental, its APIs change without a migration path, and it hasn't been tested on physical devices. The [roadmap](/docs/roadmap/) tracks what's left.",
  ],
  [
    "Does it work in Expo Go?",
    "No: Lucent adds native code, which Expo Go can't load. Use a development build, with `npx expo run:ios` or EAS Build ([Install Lucent](/docs/install/)).",
  ],
  [
    "Is my module's code in the JS bundle?",
    "No. Metro bundles a small proxy instead, and the code runs as C++ in the app binary ([How a module becomes native code](/docs/how-it-works/)).",
  ],
  [
    "Can a module import npm packages?",
    "Only other modules, `lucent:*` modules, and Lucent packages' modules. JavaScript code around it can import anything, as usual ([Language features](/docs/reference/language/)).",
  ],
  [
    "Is it faster than JavaScript?",
    "For work on data that stays in native code, often by a lot. Copying large data across the boundary can cost more than it saves: measure with `lucent bench` ([Design the boundary first](/docs/thinking/boundary-first/)).",
  ],
  [
    "Can I call any iOS or Android API?",
    "Most of them, typed from your installed SDKs. Some aren't bound yet, such as Android generics and Swift-only APIs ([SDK types](/docs/reference/platform-types/)).",
  ],
  [
    "Do I still need Xcode and Android Studio?",
    "You need their SDKs, to build the app and to type the SDK imports. You don't write Swift, Kotlin or Objective-C ([Compatibility](/docs/reference/compatibility/)).",
  ],
  [
    "How do I debug a module?",
    "Errors reach JavaScript with their `.lucent.ts` line, and native crashes point at your source ([Debug a crash](/docs/guides/debug-a-crash/)).",
  ],
  [
    "Can I publish a library written in Lucent?",
    "Yes: an npm package that ships its modules as source, compiled by each app that installs it ([Publish a Lucent library](/docs/guides/publish-a-library/)).",
  ],
  [
    "How does it compare with Nitro or Expo Modules?",
    "They have you write Swift, Kotlin or C++; Lucent has you write TypeScript. [The comparison](/docs/comparison/) has the details.",
  ],
];

export const blocks: Block[] = qa.flatMap(([question, answer]): Block[] => [
  { kind: "h2", text: question },
  { kind: "p", text: answer },
]);
