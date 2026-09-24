import * as stylex from "@stylexjs/stylex";
import { Link } from "@tanstack/react-router";
import { styles as sharedStyles } from "../styles/shared.stylex";

export function DocsNotFound() {
  return (
    <main id="main" {...stylex.props(sharedStyles.howSection)}>
      <h1>No such page.</h1>
      <Link to="/docs/" {...stylex.props(sharedStyles.button)}>
        Back to the docs
      </Link>
    </main>
  );
}
