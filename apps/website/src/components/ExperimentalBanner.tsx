import * as stylex from "@stylexjs/stylex";
import { styles } from "./ExperimentalBanner.stylex";

/** Sitewide notice. Lucent is research-stage; it must not be shipped in a production app. */
export function ExperimentalBanner() {
  return (
    <div role="note" {...stylex.props(styles.banner)}>
      <span aria-hidden="true" {...stylex.props(styles.mark)}>
        !
      </span>
      <p {...stylex.props(styles.text)}>
        <strong {...stylex.props(styles.label)}>Very early and experimental.</strong> The language, the generated native
        code and every package API change without notice. Do not use Lucent in production.
      </p>
    </div>
  );
}
