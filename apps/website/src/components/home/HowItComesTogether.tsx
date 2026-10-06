import Link from "@docusaurus/Link";
import { StackArt } from "./StackArt";

const steps = [
  {
    number: "01 — WRITE",
    title: "Stay in TypeScript.",
    body: "Write your module in a checked TypeScript subset. Familiar types, functions, classes, and JavaScript behavior.",
  },
  {
    number: "02 — COMPILE",
    title: "Get native C++.",
    body: "Lucent generates C++20 that builds with your app. Unsupported features surface as clear build-time diagnostics.",
  },
  {
    number: "03 — CALL",
    title: "Import. Call. Done.",
    body: "A typed proxy connects your app to the compiled module through JSI. Synchronous calls return inline.",
  },
];

/** Section 01: write, compile, call, and the stack it builds. */
export function HowItComesTogether() {
  return (
    <section className="section wrap">
      <div className="section-head">
        <div>
          <p className="kicker mono">01 / HOW IT COMES TOGETHER</p>
          <h2>
            One language.
            <br />
            <span>Native all the way down.</span>
          </h2>
        </div>
        <Link to="/docs/architecture/">Inside the compiler ↗</Link>
      </div>

      <div className="three">
        {steps.map((step) => (
          <article key={step.number} className="feature">
            <p className="number mono">{step.number}</p>
            <h3>{step.title}</h3>
            <p className="bodycopy">{step.body}</p>
          </article>
        ))}
      </div>

      <div className="architecture">
        <div className="architecture-label mono">ONE LANGUAGE. NATIVE ON BOTH SIDES.</div>
        <div className="architecture-content">
          <div>
            <StackArt />
          </div>
          <div className="architecture-legend">
            <div>
              <p className="stack-source mono">.lucent.ts + .lucent.tsx</p>
              <b>One source language.</b>
              <p>Write native functions and components in TypeScript.</p>
            </div>
            <div>
              <b>Compiled native logic.</b>
              <p>
                C++20 powers your modules and view logic. JSI connects module calls to React Native.
              </p>
            </div>
            <div>
              <b>Each platform’s own UI.</b>
              <p>
                Toolkit JSX becomes SwiftUI or Compose source. Fabric brings your views into the
                app.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
