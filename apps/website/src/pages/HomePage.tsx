import * as stylex from "@stylexjs/stylex";
import { Link } from "@tanstack/react-router";
import { styles } from "./HomePage.stylex";
import { styles as sharedStyles } from "../styles/shared.stylex";
import { CompilerDemo } from "../components/CompilerDemo";
import { FeatureCard } from "../components/FeatureCard";
import { NativeViewsFeature } from "../components/NativeViewsFeature";
import { useClipboard } from "../components/ClipboardProvider";
import { useDocumentMeta } from "../components/useDocumentMeta";
import { commands } from "../content";

export function HomePage() {
  const { copy } = useClipboard();
  useDocumentMeta(
    "Lucent — TypeScript in. Native out.",
    "One TypeScript module becomes the Swift and the Kotlin for an Expo or Nitro boundary. Native functions, objects, events, and SwiftUI / Compose views, with no JavaScript engine on the native side.",
  );
  return (
    <main id="main">
      <section aria-labelledby="hero-heading" {...stylex.props(styles.hero)}>
        <div {...stylex.props(styles.heroCopy)}>
          <div {...stylex.props(styles.eyebrow)}>
            <span aria-hidden="true" {...stylex.props(styles.tinyMark)}>
              ✳
            </span>
            {" THE AHEAD-OF-TIME TYPESCRIPT COMPILER"}
          </div>
          <h1 id="hero-heading" {...stylex.props(styles.heroHeading)}>
            TypeScript in.
            <br />
            <span {...stylex.props(sharedStyles.brandPeriod)}>Native out.</span>
          </h1>
          <p {...stylex.props(styles.heroDescription)}>
            One module.
            <br />
            Not two native implementations.
          </p>
          <p {...stylex.props(styles.heroDetail)}>
            Lucent compiles a checked TypeScript subset to Swift and Kotlin for the Expo Modules and Nitro boundary:
            typed proxies, native objects, events, and SwiftUI / Compose views. Write Swift, Kotlin, a JSI call, or Wasm
            when you need the whole language or a runtime on the native side.
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
            <span {...stylex.props(styles.footnoteItem)}>EXPO + NITRO</span>
          </div>
        </div>
        <CompilerDemo />
      </section>

      <section aria-label="Supported platforms and integrations" {...stylex.props(styles.platformStrip)}>
        <span {...stylex.props(styles.stripIntro)}>
          Fits right into
          <br {...stylex.props(styles.br)} />
          your native stack.
        </span>
        <div {...stylex.props(styles.platformItem)}>
          <img src="/brand/react-native.svg" alt="" aria-hidden="true" width="32" height="32" {...stylex.props(styles.platformLogo)} />
          {" React Native"}
        </div>
        <div {...stylex.props(styles.platformItem)}>
          <img src="/brand/expo.svg" alt="" aria-hidden="true" width="32" height="32" {...stylex.props(styles.platformLogo)} />
          {" Expo Modules"}
        </div>
        <div {...stylex.props(styles.platformItem)}>
          <img src="/brand/nitro.png" alt="" aria-hidden="true" width="32" height="32" {...stylex.props(styles.platformLogo)} />
          {" Nitro Modules"}
        </div>
        <span {...stylex.props(styles.platformNote)}>
          iOS & Android
          <br />
          from one source
        </span>
      </section>

      <section id="how-it-works" aria-labelledby="how-heading" {...stylex.props(sharedStyles.howSection)}>
        <div {...stylex.props(styles.sectionIntro)}>
          <div>
            <span {...stylex.props(sharedStyles.eyebrow2)}>LESS TRANSLATION. MORE CREATION.</span>
            <h2 id="how-heading" {...stylex.props(styles.howHeading)}>
              Your logic. Your UI. <span {...stylex.props(styles.sectionHeadingMuted)}>On native terms.</span>
            </h2>
          </div>
          <p {...stylex.props(styles.sectionDescription)}>
            Write it once in <code {...stylex.props(styles.sectionInlineCode)}>*.lucent.ts / *.lucent.tsx</code>.
            <br />
            The compiler handles the rest.
          </p>
        </div>
        <div {...stylex.props(styles.features)}>
          <FeatureCard
            number="01"
            position="first"
            icon={<path d="m11 8-8 8 8 8m10-16 8 8-8 8M18 4l-4 24"></path>}
            title="A small, checked subset."
            text="Functions, records, unions, resources, subscriptions, native classes, and views with state and effects. Outside the subset is a build-time diagnostic, never a runtime surprise."
            href="/docs/language/"
            linkLabel="Read the language"
          />
          <FeatureCard
            number="02"
            position="middle"
            icon={<path d="M18 3 7 18h9l-2 11 12-16h-10z"></path>}
            title="Native all the way down."
            text="Readable Swift and Kotlin, compiled ahead of time. Logic runs natively; views render through SwiftUI and Jetpack Compose. Open the output in Xcode or Android Studio."
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
            title="Two hosts. One workflow."
            text="Expo Modules or Nitro, your choice. Generated modules autolink, Metro swaps in a typed proxy at bundle time, and Fast Refresh keeps working for the React side."
            href="/docs/getting-started/"
            linkLabel="Set it up"
          />
        </div>
      </section>

      <NativeViewsFeature />

      <section id="platform" aria-labelledby="platform-heading" {...stylex.props(sharedStyles.howSection)}>
        <div {...stylex.props(styles.sectionIntro)}>
          <div>
            <span {...stylex.props(sharedStyles.eyebrow2)}>BEYOND THE SUBSET</span>
            <h2 id="platform-heading" {...stylex.props(styles.howHeading)}>
              Reach the platform. <span {...stylex.props(styles.sectionHeadingMuted)}>Stay typed.</span>
            </h2>
          </div>
          <p {...stylex.props(styles.sectionDescription)}>
            Files, crypto, network, device, threads and SDK classes.
            <br />
            Declared once, checked at build time.
          </p>
        </div>
        <div {...stylex.props(styles.features)}>
          <FeatureCard
            number="04"
            position="first"
            icon={
              <>
                <path d="M6 5h13l7 7v15H6z"></path>
                <path d="M19 5v7h7M11 19h10M11 23h10"></path>
              </>
            }
            title="Bring your own SDK."
            text="Lucent ships byte, math and text primitives. Every platform API arrives as a package manifest: TypeScript declarations plus Swift and Kotlin bodies, with its own capabilities and platform guards."
            href="/docs/api/library-manifest/"
            linkLabel="Library manifest"
          />
          <FeatureCard
            number="05"
            position="middle"
            icon={
              <>
                <rect x="4" y="12" width="24" height="16" rx="2"></rect>
                <path d="M10 12V8a6 6 0 0 1 12 0v4M16 19v4"></path>
              </>
            }
            title="Typed capabilities."
            text="One lucent.config.ts declares what your native code may touch. Usage strings, entitlements and Android permissions are generated; anything undeclared fails the build."
            href="/docs/api/config/"
            linkLabel="Capabilities"
          />
          <FeatureCard
            number="06"
            position="last"
            icon={
              <>
                <path d="M16 3 4 10v12l12 7 12-7V10z"></path>
                <path d="M4 10l12 7 12-7M16 17v12"></path>
              </>
            }
            title="Bring any native SDK."
            text="Bind Swift and Kotlin functions and classes with a JSON manifest, or generate one from a .swiftinterface or android.jar. Ship SwiftUI and Compose views as a package."
            href="/docs/api/library-manifest/"
            linkLabel="Library manifests"
          />
        </div>
      </section>

      <section id="get-started" aria-labelledby="start-heading" {...stylex.props(styles.startSection)}>
        <div>
          <span {...stylex.props(styles.eyebrow3)}>FROM SOURCE TO SWIFT & KOTLIN</span>
          <h2 id="start-heading" {...stylex.props(styles.startHeading)}>
            Make your next
            <br {...stylex.props(styles.br2)} />
            function native.
          </h2>
          <p {...stylex.props(styles.startDescription)}>
            Install the packages into an app.
            <br />
            The compiler repository is for working on Lucent itself.
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
              <span {...stylex.props(styles.comment)}># In an Expo app</span>
              {"\nnpx expo install @lucent-lang/core"}
            </code>
          </pre>
          <div {...stylex.props(styles.terminalNote)}>
            Requires Node 22.12+ and the repository’s pinned pnpm version.{" "}
            <Link to="/docs/$/" params={{ _splat: "getting-started" }} {...stylex.props(styles.terminalLink)}>
              Full setup →
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
