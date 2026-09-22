import * as stylex from "@stylexjs/stylex";
import { Link } from "@tanstack/react-router";
import { CodeBlock } from "./CodeBlock";
import { nativeCard } from "../content";
import { styles } from "./NativeViewsFeature.stylex";
import { styles as shared } from "../styles/shared.stylex";

export function NativeViewsFeature() {
  return (
    <section id="native-views" aria-labelledby="native-views-heading" {...stylex.props(styles.section)}>
      <div {...stylex.props(styles.copy)}>
        <span {...stylex.props(shared.eyebrow2)}>NATIVE VIEWS, IN TSX</span>
        <h2 id="native-views-heading" {...stylex.props(styles.heading)}>
          One component.
          <br />
          <span {...stylex.props(styles.accent)}>Both platforms.</span>
        </h2>
        <p {...stylex.props(styles.description)}>
          Compose native views in .lucent.tsx. The same source becomes SwiftUI on iOS and Jetpack Compose on Android.
        </p>
        <div {...stylex.props(styles.targets)}>
          <span>iOS / SwiftUI</span>
          <span>Android / Compose</span>
        </div>
        <p {...stylex.props(styles.detail)}>
          Stacks, text, buttons, text fields, toggles and sliders, plus padding, background, corner radius and
          accessibility wrappers. Keep state in React; inputs are controlled and report through typed events. Ship your
          own SwiftUI and Compose views as a package when the shared set is not enough.
        </p>
        <Link to="/docs/$/" params={{ _splat: "language/native-views" }} {...stylex.props(styles.link)}>
          Native views reference <span aria-hidden="true">↗</span>
        </Link>
        <p {...stylex.props(styles.note)}>Compiled ahead of time. Native source changes require an app rebuild.</p>
      </div>
      <div {...stylex.props(styles.code)}>
        <CodeBlock filename="card.lucent.tsx" code={nativeCard} />
      </div>
    </section>
  );
}
