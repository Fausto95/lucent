import * as stylex from "@stylexjs/stylex";
import { styles } from "./DocsContent.stylex";
import { SmartLink } from "./SmartLink";

const TOKEN = /(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\))/g;
const LINK = /^\[([^\]]+)\]\(([^)]+)\)$/;

/** Renders the docs inline markup: `code`, **strong**, [text](href). */
export function Inline({ text }: { text: string }) {
  return text.split(TOKEN).map((token, index) => {
    if (token.startsWith("`")) {
      return (
        <code key={index} {...stylex.props(styles.inlineCode)}>
          {token.slice(1, -1)}
        </code>
      );
    }
    if (token.startsWith("**")) {
      return (
        <strong key={index} {...stylex.props(styles.strong)}>
          {token.slice(2, -2)}
        </strong>
      );
    }
    const link = LINK.exec(token);
    if (link) {
      return (
        <SmartLink key={index} href={link[2]!} {...stylex.props(styles.link)}>
          {link[1]}
        </SmartLink>
      );
    }
    return token;
  });
}
