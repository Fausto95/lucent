import * as stylex from "@stylexjs/stylex";
import { Link } from "@tanstack/react-router";
import { styles } from "./HomePage.stylex";
import { styles as sharedStyles } from "../styles/shared.stylex";
import { CompilerDemo } from "../components/CompilerDemo";
import { FeatureCard } from "../components/FeatureCard";
import { CodeBlock } from "../components/CodeBlock";
import { ComparisonTable } from "../components/ComparisonTable";
import { useClipboard } from "../components/ClipboardProvider";
import { useDocumentMeta } from "../components/useDocumentMeta";
import { commands, platformTeaser } from "../content";

export function HomePage() {
  const { copy } = useClipboard();
  useDocumentMeta(
    "Lucent — native modules for React Native, written in TypeScript.",
    "Lucent compiles a checked TypeScript subset to C++ and calls it through JSI. No Swift or Kotlin to write, and no JavaScript engine on the native side.",
  );
  return (
    <main id="main">
      <section aria-labelledby="hero-heading" {...stylex.props(styles.hero)}>
        <div {...stylex.props(styles.heroCopy)}>
          <div {...stylex.props(styles.eyebrow)}>
            <span aria-hidden="true" {...stylex.props(styles.tinyMark)}>
              ✳
            </span>
            {" AN AHEAD-OF-TIME TYPESCRIPT TO C++ COMPILER"}
          </div>
          <h1 id="hero-heading" {...stylex.props(styles.heroHeading)}>
            Native modules for React Native,
            <br />
            <span {...stylex.props(sharedStyles.brandPeriod)}>written in TypeScript.</span>
          </h1>
          <p {...stylex.props(styles.heroDescription)}>
            One module.
            <br />
            No Swift or Kotlin to write.
          </p>
          <p {...stylex.props(styles.heroDetail)}>
            Lucent compiles a checked TypeScript subset to C++20 and calls it through JSI. The code behaves as it would
            in JavaScript, and nothing runs in a JS engine on the native side.
          </p>
          <div {...stylex.props(styles.heroActions)}>
            <Link to="/docs/$/" params={{ _splat: "getting-started" }} {...stylex.props(sharedStyles.button)}>
              Get started
              <span aria-hidden="true" {...stylex.props(sharedStyles.buttonArrow)}>
                ↗
              </span>
            </Link>
            <Link to="/docs/$/" params={{ _splat: "how-it-works" }} {...stylex.props(styles.textLink)}>
              How it works <span aria-hidden="true">→</span>
            </Link>
          </div>
          <div {...stylex.props(styles.heroFootnote)}>
            <span {...stylex.props(styles.footnoteWarn)}>EXPERIMENTAL — NOT FOR PRODUCTION</span>
            <span {...stylex.props(styles.footnoteItem)}>OPEN SOURCE</span>
            <span {...stylex.props(styles.footnoteItem)}>MIT LICENSE</span>
            <span {...stylex.props(styles.footnoteItem)}>BARE RN + EXPO</span>
          </div>
        </div>
        <CompilerDemo />
      </section>

      <section aria-label="Supported platforms" {...stylex.props(styles.platformStrip)}>
        <span {...stylex.props(styles.stripIntro)}>
          Runs where
          <br {...stylex.props(styles.br)} />
          your app runs.
        </span>
        <div {...stylex.props(styles.platformItem)}>
          <img src="/brand/react-native.svg" alt="" aria-hidden="true" width="32" height="32" {...stylex.props(styles.platformLogo)} />
          {" React Native"}
        </div>
        <div {...stylex.props(styles.platformItem)}>
          <span aria-hidden="true" {...stylex.props(styles.platformLogo, styles.expoLogo)} />
          {" Expo"}
        </div>
        <div {...stylex.props(styles.platformItem)}>New Architecture</div>
        <span {...stylex.props(styles.platformNote)}>
          iOS & Android
          <br />
          from one source
        </span>
      </section>

      <section id="how-it-works" aria-labelledby="how-heading" {...stylex.props(sharedStyles.howSection)}>
        <div {...stylex.props(styles.sectionIntro)}>
          <div>
            <span {...stylex.props(sharedStyles.eyebrow2)}>HOW IT WORKS</span>
            <h2 id="how-heading" {...stylex.props(styles.howHeading)}>
              Your logic. <span {...stylex.props(styles.sectionHeadingMuted)}>Compiled, not interpreted.</span>
            </h2>
          </div>
          <p {...stylex.props(styles.sectionDescription)}>
            Write it once in <code {...stylex.props(styles.sectionInlineCode)}>*.lucent.ts</code>.
            <br />
            The compiler handles the rest.
          </p>
        </div>
        <div {...stylex.props(styles.features)}>
          <FeatureCard
            number="01"
            position="first"
            icon={<path d="m11 8-8 8 8 8m10-16 8 8-8 8M18 4l-4 24"></path>}
            title="A checked subset."
            text="The real TypeScript checker in strict mode, then Lucent's own rules. Structs, unions, classes, closures, generics, async and errors behave as they do in JavaScript. Anything outside the subset is a stable LUCENT diagnostic at build time."
            href="/docs/language/"
            linkLabel="Read the language"
          />
          <FeatureCard
            number="02"
            position="middle"
            icon={<path d="M18 3 7 18h9l-2 11 12-16h-10z"></path>}
            title="Native all the way."
            text="C++20 with a small runtime, called through JSI from one pure C++ TurboModule. Synchronous calls return inline; async functions run off the JS thread and resolve on it."
            href="/docs/how-it-works/"
            linkLabel="See the pipeline"
          />
          <FeatureCard
            number="03"
            position="last"
            icon={
              <>
                <rect x="3" y="5" width="10" height="22" rx="2"></rect>
                <rect x="19" y="5" width="10" height="22" rx="2"></rect>
                <path d="M7 23h2m14 0h2M13 16h6"></path>
              </>
            }
            title="One module. Both platforms, both hosts."
            text="The same source builds for iOS and Android, in bare React Native and in Expo. CocoaPods and CMake autolink it, and Metro swaps each import for a typed proxy."
            href="/docs/getting-started/"
            linkLabel="Set it up"
          />
        </div>
      </section>

      <section id="platform" aria-labelledby="platform-heading" {...stylex.props(sharedStyles.howSection)}>
        <div {...stylex.props(styles.sectionIntro)}>
          <div>
            <span {...stylex.props(sharedStyles.eyebrow2)}>PLANNED · PLATFORM APIS</span>
            <h2 id="platform-heading" {...stylex.props(styles.howHeading)}>
              Import the SDK. <span {...stylex.props(styles.sectionHeadingMuted)}>Stay typed.</span>
            </h2>
          </div>
          <p {...stylex.props(styles.sectionDescription)}>
            Typed bindings for iOS and Android APIs, called directly from Lucent.
            <br />
            Early today; this is where it is going.
          </p>
        </div>
        <CodeBlock filename="location.ios.lucent.ts · planned" code={platformTeaser} />
        <p {...stylex.props(styles.sectionFootnote)}>
          Not available yet. See the{" "}
          <Link to="/docs/$/" params={{ _splat: "platform-apis" }} {...stylex.props(styles.footnoteLink)}>
            platform APIs page
          </Link>{" "}
          for what works today, and the{" "}
          <a href="https://github.com/Fausto95/lucent/blob/cpp-jsi/ROADMAP.md" {...stylex.props(styles.footnoteLink)}>
            roadmap
          </a>
          .
        </p>
      </section>

      <section id="comparison" aria-labelledby="comparison-heading" {...stylex.props(sharedStyles.howSection)}>
        <div {...stylex.props(styles.sectionIntro)}>
          <div>
            <span {...stylex.props(sharedStyles.eyebrow2)}>COMPARISON</span>
            <h2 id="comparison-heading" {...stylex.props(styles.howHeading)}>
              Same JSI call path. <span {...stylex.props(styles.sectionHeadingMuted)}>Different source.</span>
            </h2>
          </div>
          <p {...stylex.props(styles.sectionDescription)}>
            How Lucent relates to Expo Modules, Nitro and TurboModules.
            <br />
            <Link to="/docs/$/" params={{ _splat: "comparison" }} {...stylex.props(styles.textLink)}>
              Full comparison <span aria-hidden="true">→</span>
            </Link>
          </p>
        </div>
        <ComparisonTable compact />
      </section>

      <section id="get-started" aria-labelledby="start-heading" {...stylex.props(styles.startSection)}>
        <div>
          <span {...stylex.props(styles.eyebrow3)}>FROM TYPESCRIPT TO C++</span>
          <h2 id="start-heading" {...stylex.props(styles.startHeading)}>
            Make your next
            <br {...stylex.props(styles.br2)} />
            function native.
          </h2>
          <p {...stylex.props(styles.startDescription)}>
            Add Lucent to a bare React Native or Expo app.
            <br />
            Packages are not on npm yet: see the setup guide.
          </p>
          <Link to="/docs/$/" params={{ _splat: "getting-started" }} {...stylex.props(styles.textLink2)}>
            Setup guide <span aria-hidden="true">→</span>
          </Link>
        </div>
        <div {...stylex.props(styles.terminal)}>
          <div {...stylex.props(styles.terminalBar)}>
            <span>GET STARTED</span>
            <button
              type="button"
              onClick={() => copy(commands)}
              id="copy-command"
              aria-label="Copy commands"
              {...stylex.props(styles.copyCommand)}
            >
              Copy
              <span aria-hidden="true">⧉</span>
            </button>
          </div>
          <pre {...stylex.props(styles.terminalCode)}>
            <code>
              <span {...stylex.props(styles.comment)}># In a React Native app</span>
              {`\n${commands}`}
            </code>
          </pre>
          <div {...stylex.props(styles.terminalNote)}>
            Requires Node 22.12+ and a development build (not Expo Go).{" "}
            <Link to="/docs/$/" params={{ _splat: "getting-started" }} {...stylex.props(styles.terminalLink)}>
              Full setup →
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
