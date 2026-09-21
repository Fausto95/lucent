import * as stylex from "@stylexjs/stylex";
import { Link } from "@tanstack/react-router";
import { CodeBlock } from "../components/CodeBlock";
import { styles as reference } from "./LanguagePage.stylex";
import { styles } from "./GetStartedPage.stylex";
import { styles as sharedStyles } from "../styles/shared.stylex";

const MODULE_EXAMPLE =
  "// src/geo.lucent.ts\nexport type Point = { x: number; y: number };\n\nexport function squaredDistance(a: Point, b: Point): number {\n  const dx = a.x - b.x;\n  const dy = a.y - b.y;\n  return dx * dx + dy * dy;\n}";

const USE_EXAMPLE =
  'import { squaredDistance } from "./src/geo.lucent";\n\nsquaredDistance({ x: 0, y: 0 }, { x: 3, y: 4 }); // 25, computed in Swift / Kotlin';

const EXPO_INSTALL =
  "npx expo install @lucent-lang/runtime @lucent-lang/types @lucent-lang/expo @lucent-lang/metro";

const EXPO_METRO =
  'const { getDefaultConfig } = require("expo/metro-config");\nconst { withLucent } = require("@lucent-lang/metro");\n\nmodule.exports = withLucent(getDefaultConfig(__dirname), { host: "expo" });';

const EXPO_APP_JSON = '{\n  "expo": {\n    "plugins": [["@lucent-lang/expo", { "host": "expo" }]]\n  }\n}';

const EXPO_RUN = "npx expo prebuild\nnpx expo run:ios   # or run:android";

const BARE_INSTALL =
  "npm install @lucent-lang/runtime react-native-nitro-modules\nnpm install -D @lucent-lang/types @lucent-lang/metro @lucent-lang/cli nitrogen";

const BARE_METRO =
  'const { getDefaultConfig, mergeConfig } = require("@react-native/metro-config");\nconst { withLucent } = require("@lucent-lang/metro");\n\nmodule.exports = withLucent(mergeConfig(getDefaultConfig(__dirname), {}), { host: "nitro" });';

const BARE_RN_CONFIG =
  'const path = require("path");\n\nmodule.exports = {\n  dependencies: {\n    "lucent-native": { root: path.join(__dirname, ".lucent", "nitro") },\n  },\n};';

const BARE_RUN = "npx lucent build --host nitro\ncd ios && pod install && cd ..\nnpx react-native run-ios   # or run-android";

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li {...stylex.props(styles.step)}>
      <h3 {...stylex.props(styles.stepTitle)}>
        <span aria-hidden="true" {...stylex.props(styles.stepNumber)}>
          {n}
        </span>
        {title}
      </h3>
      {children}
    </li>
  );
}

export function GetStartedPage() {
  return (
    <main id="main" {...stylex.props(styles.layout)}>
      <section id="overview" {...stylex.props(reference.referenceIntro)}>
        <div {...stylex.props(reference.referenceKicker)}>
          <span {...stylex.props(sharedStyles.eyebrow2)}>{"FIVE MINUTES TO NATIVE."}</span>
        </div>
        <h1 {...stylex.props(reference.referenceHeading)}>
          {"Get "}
          <span {...stylex.props(reference.referenceHeadingAccent)}>{"started."}</span>
        </h1>
        <p {...stylex.props(reference.referenceLead)}>
          {"Add Lucent to an Expo app or a bare React Native app, write a "}
          <code {...stylex.props(reference.referenceInlineCode)}>{"*.lucent.ts"}</code>
          {" file, and import it like any other module."}
        </p>
        <div {...stylex.props(reference.referenceNote)}>
          <span aria-hidden="true" {...stylex.props(reference.noteMark)}>
            {"↳"}
          </span>
          <p {...stylex.props(reference.referenceNoteText)}>
            {
              "Lucent generates native code, so it needs a development build. Expo Go cannot load it, the same as any other native module."
            }
          </p>
        </div>
      </section>

      <section id="expo" {...stylex.props(reference.referenceSection)}>
        <div {...stylex.props(reference.referenceSectionLabel)}>{"01 / EXPO"}</div>
        <h2 {...stylex.props(reference.referenceSectionHeading)}>{"Expo (SDK 58)"}</h2>
        <p {...stylex.props(reference.referenceParagraph)}>
          {
            "The config plugin compiles your modules during prebuild into an autolinked Expo Module, and the Metro plugin swaps each Lucent file for its JavaScript proxy at bundle time."
          }
        </p>
        <ol {...stylex.props(styles.steps)}>
          <Step n={1} title="Install">
            <CodeBlock filename="terminal" code={EXPO_INSTALL} />
          </Step>
          <Step n={2} title="Configure Metro">
            <CodeBlock filename="metro.config.js" code={EXPO_METRO} />
          </Step>
          <Step n={3} title="Add the config plugin">
            <CodeBlock filename="app.json" code={EXPO_APP_JSON} />
          </Step>
          <Step n={4} title="Write a module">
            <CodeBlock filename="src/geo.lucent.ts" code={MODULE_EXAMPLE} />
          </Step>
          <Step n={5} title="Use it">
            <CodeBlock filename="App.tsx" code={USE_EXAMPLE} />
          </Step>
          <Step n={6} title="Build and run">
            <CodeBlock filename="terminal" code={EXPO_RUN} />
            <p {...stylex.props(reference.referenceCaveat)}>
              {"Generated code lands in "}
              <code {...stylex.props(reference.referenceInlineCode)}>{"modules/lucent/"}</code>
              {", which Expo autolinks. Unchanged modules are cached between builds."}
            </p>
          </Step>
        </ol>
      </section>

      <section id="bare" {...stylex.props(reference.referenceSection)}>
        <div {...stylex.props(reference.referenceSectionLabel)}>{"02 / BARE REACT NATIVE"}</div>
        <h2 {...stylex.props(reference.referenceSectionHeading)}>{"Bare React Native (Nitro)"}</h2>
        <p {...stylex.props(reference.referenceParagraph)}>
          {
            "Without Expo, Lucent targets Nitro Modules. The CLI generates a local library, runs nitrogen for you, and React Native autolinks it."
          }
        </p>
        <ol {...stylex.props(styles.steps)}>
          <Step n={1} title="Install">
            <CodeBlock filename="terminal" code={BARE_INSTALL} />
          </Step>
          <Step n={2} title="Configure Metro">
            <CodeBlock filename="metro.config.js" code={BARE_METRO} />
          </Step>
          <Step n={3} title="Register the generated library">
            <CodeBlock filename="react-native.config.js" code={BARE_RN_CONFIG} />
          </Step>
          <Step n={4} title="Write a module">
            <CodeBlock filename="src/geo.lucent.ts" code={MODULE_EXAMPLE} />
          </Step>
          <Step n={5} title="Build and run">
            <CodeBlock filename="terminal" code={BARE_RUN} />
            <p {...stylex.props(reference.referenceCaveat)}>
              {"Run "}
              <code {...stylex.props(reference.referenceInlineCode)}>{"npx lucent build --host nitro"}</code>
              {" again whenever a Lucent file changes; it writes to "}
              <code {...stylex.props(reference.referenceInlineCode)}>{".lucent/nitro/"}</code>
              {"."}
            </p>
          </Step>
        </ol>
      </section>

      <section id="cli" {...stylex.props(reference.referenceSection)}>
        <div {...stylex.props(reference.referenceSectionLabel)}>{"03 / THE CLI"}</div>
        <h2 {...stylex.props(reference.referenceSectionHeading)}>{"Commands"}</h2>
        <CodeBlock
          filename="terminal"
          code={
            "lucent build [--host expo|nitro] [--emit-ir] [--force] [files…]   compile and emit the native package\nlucent check [files…]                                             type-check only\nlucent init [--host expo|nitro]                                   wire a project's package.json"
          }
        />
      </section>

      <section {...stylex.props(reference.referenceNext)}>
        <h2 {...stylex.props(reference.referenceNextHeading)}>{"Next: what you can write"}</h2>
        <Link to="/language/" {...stylex.props(reference.referenceNextButton)}>
          {"Read the language reference →"}
        </Link>
      </section>
    </main>
  );
}
