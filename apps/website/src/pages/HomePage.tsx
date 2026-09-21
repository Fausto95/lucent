import * as stylex from "@stylexjs/stylex";
import { Link } from "@tanstack/react-router";
import { styles } from "./HomePage.stylex";
import { styles as sharedStyles } from "../styles/shared.stylex";
import { CompilerDemo } from "../components/CompilerDemo";
import { useClipboard } from "../components/ClipboardProvider";
import { commands } from "../content";
export function HomePage() {
  const { copy } = useClipboard();
  return (
    <main id="main">
      <section aria-labelledby="hero-heading" {...stylex.props(styles.hero)}>
        <div {...stylex.props(styles.heroCopy)}>
          <div {...stylex.props(styles.eyebrow)}>
            <span aria-hidden="true" {...stylex.props(styles.tinyMark)}>
              {"✳"}
            </span>
            {" THE AHEAD-OF-TIME TYPESCRIPT COMPILER"}
          </div>
          <h1 id="hero-heading" {...stylex.props(styles.heroHeading)}>
            {"TypeScript in."}
            <br />
            <span {...stylex.props(sharedStyles.brandPeriod)}>{"Native out."}</span>
          </h1>
          <p {...stylex.props(styles.heroDescription)}>
            {"The language you love."}
            <br />
            {"The native code you need."}
          </p>
          <p {...stylex.props(styles.heroDetail)}>
            {
              "Compile a focused subset of TypeScript to Swift and Kotlin. Built for React Native. Native execution, from the first call."
            }
          </p>
          <div {...stylex.props(styles.heroActions)}>
            <Link to="/" hash="get-started" {...stylex.props(sharedStyles.button)}>
              {"Start building "}
              <span aria-hidden="true" {...stylex.props(sharedStyles.buttonArrow)}>
                {"↗"}
              </span>
            </Link>
            <Link to="/language/" {...stylex.props(styles.textLink)}>
              {"Explore the language "}
              <span aria-hidden="true">{"→"}</span>
            </Link>
          </div>
          <div {...stylex.props(styles.heroFootnote)}>
            <span>{"OPEN SOURCE"}</span>
            <span {...stylex.props(styles.footnoteItem)}>{"MIT LICENSE"}</span>
            <span {...stylex.props(styles.footnoteItem)}>{"EXPO + NITRO"}</span>
          </div>
        </div>
        <CompilerDemo />
      </section>
      <section aria-label="Supported platforms and integrations" {...stylex.props(styles.platformStrip)}>
        <span {...stylex.props(styles.stripIntro)}>
          {"Fits right into"}
          <br {...stylex.props(styles.br)} />
          {"your native stack."}
        </span>
        <div {...stylex.props(styles.platformItem)}>
          <img
            src="/brand/react-native.svg"
            alt=""
            aria-hidden="true"
            width="32"
            height="32"
            {...stylex.props(styles.platformLogo)}
          />
          {" React Native"}
        </div>
        <div {...stylex.props(styles.platformItem)}>
          <img
            src="/brand/expo.svg"
            alt=""
            aria-hidden="true"
            width="32"
            height="32"
            {...stylex.props(styles.platformLogo)}
          />
          {" Expo Modules"}
        </div>
        <div {...stylex.props(styles.platformItem)}>
          <img
            src="/brand/nitro.png"
            alt=""
            aria-hidden="true"
            width="32"
            height="32"
            {...stylex.props(styles.platformLogo)}
          />
          {" Nitro Modules"}
        </div>
        <span {...stylex.props(styles.platformNote)}>
          {"iOS & Android"}
          <br />
          {"from one source"}
        </span>
      </section>
      <section id="how-it-works" aria-labelledby="how-heading" {...stylex.props(sharedStyles.howSection)}>
        <div {...stylex.props(styles.sectionIntro)}>
          <div>
            <span {...stylex.props(sharedStyles.eyebrow2)}>{"LESS TRANSLATION. MORE CREATION."}</span>
            <h2 id="how-heading" {...stylex.props(styles.howHeading)}>
              {"Your logic. "}
              <span {...stylex.props(styles.sectionHeadingMuted)}>{"On native terms."}</span>
            </h2>
          </div>
          <p {...stylex.props(styles.sectionDescription)}>
            {"Write it once in "}
            <code {...stylex.props(styles.sectionInlineCode)}>{"*.lucent.ts"}</code>
            {"."}
            <br />
            {"Let the compiler handle the rest."}
          </p>
        </div>
        <div {...stylex.props(styles.features)}>
          <article {...stylex.props(styles.article)}>
            <div {...stylex.props(styles.featureTop)}>
              <span {...stylex.props(styles.featureNumber)}>{"01"}</span>
              <svg viewBox="0 0 32 32" aria-hidden="true" {...stylex.props(styles.featureIcon)}>
                <path d="m11 8-8 8 8 8m10-16 8 8-8 8M18 4l-4 24"></path>
              </svg>
            </div>
            <h3 {...stylex.props(styles.featureHeading)}>{"Familiar by design."}</h3>
            <p {...stylex.props(styles.featureDescription)}>
              {
                "Functions, arrays, structs, and async. A deliberate TypeScript subset with explicit types and clear compile-time diagnostics."
              }
            </p>
            <Link to="/language/" {...stylex.props(styles.featureLink)}>
              {"Meet the language "}
              <span aria-hidden="true">{"↗"}</span>
            </Link>
          </article>
          <article {...stylex.props(styles.article2)}>
            <div {...stylex.props(styles.featureTop)}>
              <span {...stylex.props(styles.featureNumber)}>{"02"}</span>
              <svg viewBox="0 0 32 32" aria-hidden="true" {...stylex.props(styles.featureIcon)}>
                <path d="M18 3 7 18h9l-2 11 12-16h-10z"></path>
              </svg>
            </div>
            <h3 {...stylex.props(styles.featureHeading)}>{"Native all the way down."}</h3>
            <p {...stylex.props(styles.featureDescription)}>
              {
                "Readable Swift and Kotlin, compiled ahead of time. Your Lucent functions run as native code, with no JavaScript engine on the native side."
              }
            </p>
            <a href="https://github.com/Fausto95/lucent/tree/main/fixtures" {...stylex.props(styles.featureLink)}>
              {"See the generated code "}
              <span aria-hidden="true">{"↗"}</span>
            </a>
          </article>
          <article {...stylex.props(styles.article3)}>
            <div {...stylex.props(styles.featureTop)}>
              <span {...stylex.props(styles.featureNumber)}>{"03"}</span>
              <svg viewBox="0 0 32 32" aria-hidden="true" {...stylex.props(styles.featureIcon)}>
                <rect x="3" y="5" width="10" height="22" rx="2"></rect>
                <rect x="19" y="5" width="10" height="22" rx="2"></rect>
                <path d="M7 23h2m14 0h2M13 16h6"></path>
              </svg>
            </div>
            <h3 {...stylex.props(styles.featureHeading)}>{"Two platforms. One flow."}</h3>
            <p {...stylex.props(styles.featureDescription)}>
              {
                "Connect through Expo Modules or Nitro. Generated native modules and typed JavaScript proxies keep your React Native workflow connected."
              }
            </p>
            <a href="https://github.com/Fausto95/lucent/tree/main/apps" {...stylex.props(styles.featureLink)}>
              {"Explore the examples "}
              <span aria-hidden="true">{"↗"}</span>
            </a>
          </article>
        </div>
      </section>
      <section id="get-started" aria-labelledby="start-heading" {...stylex.props(styles.startSection)}>
        <div>
          <span {...stylex.props(styles.eyebrow3)}>{"FROM SOURCE TO SWIFT & KOTLIN"}</span>
          <h2 id="start-heading" {...stylex.props(styles.startHeading)}>
            {"Make your next "}
            <br {...stylex.props(styles.br2)} />
            {"function native."}
          </h2>
          <p {...stylex.props(styles.startDescription)}>
            {"Start with the source. Build the included example."}
            <br />
            {"Then bring your own logic."}
          </p>
          <a href="https://github.com/Fausto95/lucent#requirements" {...stylex.props(styles.textLink2)}>
            {"Setup requirements "}
            <span aria-hidden="true">{"↗"}</span>
          </a>
        </div>
        <div {...stylex.props(styles.terminal)}>
          <div {...stylex.props(styles.terminalBar)}>
            <span>{"GET STARTED"}</span>
            <button onClick={() => copy(commands)} id="copy-command" {...stylex.props(styles.copyCommand)}>
              {"Copy commands "}
              <span aria-hidden="true">{"⧉"}</span>
            </button>
          </div>
          <pre {...stylex.props(styles.terminalCode)}>
            <code>
              <span {...stylex.props(styles.comment)}>{"# Get Lucent"}</span>
              {"\ngit clone https://github.com/Fausto95/lucent.git\ncd lucent\nbun install\n\n"}
              <span {...stylex.props(styles.comment)}>{"# Build your first native module"}</span>
              {"\nbun run lucent build --host expo fixtures/clamp.lucent.ts"}
            </code>
          </pre>
          <div {...stylex.props(styles.terminalNote)}>
            {"Requires Bun 1.4+ and Node 24. "}
            <a href="https://github.com/Fausto95/lucent#requirements" {...stylex.props(styles.terminalLink)}>
              {"Full setup ↗"}
            </a>
          </div>
        </div>
      </section>
    </main>
  );
}
