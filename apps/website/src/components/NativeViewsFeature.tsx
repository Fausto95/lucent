import * as stylex from "@stylexjs/stylex";
import { Link } from "@tanstack/react-router";
import { CodeBlock } from "./CodeBlock";
import { nativeCard } from "../nativeExamples";
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
          Keep state in React. Pass typed props and callbacks to native components. Import another Lucent component when
          you want to build something bigger.
        </p>
        <Link to="/language/" hash="native-views" {...stylex.props(styles.link)}>
          Explore native views <span aria-hidden="true">↗</span>
        </Link>
        <p {...stylex.props(styles.note)}>Compiled ahead of time. Native source changes require an app rebuild.</p>
      </div>
      <div {...stylex.props(styles.code)}>
        <CodeBlock filename="card.lucent.tsx" code={nativeCard} />
      </div>
    </section>
  );
}
