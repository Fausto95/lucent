import * as stylex from "@stylexjs/stylex";
import { Link } from "@tanstack/react-router";
import { styles as sharedStyles } from "../styles/shared.stylex";

export function NotFound() {
  return (
    <main id="main" {...stylex.props(sharedStyles.howSection)}>
      <h1>Page not found.</h1>
      <Link to="/" {...stylex.props(sharedStyles.button)}>
        Back to Lucent
      </Link>
    </main>
  );
}
