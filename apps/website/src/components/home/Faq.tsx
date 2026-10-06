import Link from "@docusaurus/Link";

/** Section 02: what people ask first, the first question open. */
export function Faq() {
  return (
    <section className="section wrap faq">
      <div>
        <p className="kicker mono">02 / A FEW GOOD QUESTIONS</p>
        <h2>
          Know what
          <br />
          you’re building on.
        </h2>
      </div>
      <div>
        <details open>
          <summary>Is this all of TypeScript?</summary>
          <p className="bodycopy">
            Lucent compiles a checked subset. Supported features follow JavaScript semantics;
            unsupported features produce LUCENT diagnostics at build time.{" "}
            <Link className="textlink" to="/docs/api/language/">
              Read the language reference →
            </Link>
          </p>
        </details>
        <details>
          <summary>Does JavaScript run on the native side?</summary>
          <p className="bodycopy">
            No. Module logic compiles to C++20 and is called through JSI. View logic also compiles
            to C++; SwiftUI and Compose bodies become Swift and Kotlin, hosted by Fabric.
          </p>
        </details>
        <details>
          <summary>Can I use it with Expo?</summary>
          <p className="bodycopy">
            Yes, with an Expo development build. Lucent includes native code, so it requires a
            native build and does not run in Expo Go.
          </p>
        </details>
        <details>
          <summary>How does it compare to other native module tools?</summary>
          <p className="bodycopy">
            Lucent uses a native JSI call path while letting you author modules in TypeScript.{" "}
            <Link className="textlink" to="/docs/guides/comparison/">
              Compare with Expo Modules, Nitro, and TurboModules →
            </Link>
          </p>
        </details>
      </div>
    </section>
  );
}
