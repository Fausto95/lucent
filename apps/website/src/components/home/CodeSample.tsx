import type { ComponentProps } from "react";
import type { Token } from "./samples";

interface CodeSampleProps extends ComponentProps<"pre"> {
  tokens: Token[];
}

/** A code sample as preformatted text, its keywords and comments colored. */
export function CodeSample({ tokens, ...pre }: CodeSampleProps) {
  return (
    <pre {...pre}>
      {tokens.map((token, i) =>
        typeof token === "string" ? (
          token
        ) : (
          <span key={i} className={token.className}>
            {token.text}
          </span>
        ),
      )}
    </pre>
  );
}
