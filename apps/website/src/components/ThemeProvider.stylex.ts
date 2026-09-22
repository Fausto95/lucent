import * as stylex from "@stylexjs/stylex";
import { tokens } from "../styles/tokens.stylex";

export const styles = stylex.create({
  /** Applied to <html> so the whole canvas, including overscroll, follows the tokens. */
  document: {
    backgroundColor: tokens.bg,
    color: tokens.text,
    colorScheme: tokens.scheme,
  },
});
