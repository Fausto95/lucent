/**
 * A docs page's content, led by its description: the docs' writing rules make
 * the frontmatter description the page's answer, so it reads under the title
 * (Docusaurus' synthetic H1) before the rest of the page.
 */
import { useDoc } from "@docusaurus/plugin-content-docs/client";
import type { WrapperProps } from "@docusaurus/types";
import Content from "@theme-original/DocItem/Content";
import type ContentType from "@theme/DocItem/Content";
import type { ReactNode } from "react";
import { inlineHtml } from "../../../docs/inline-html";

type Props = WrapperProps<typeof ContentType>;

export default function ContentWrapper({ children, ...props }: Props): ReactNode {
  const { description } = useDoc().frontMatter;

  return (
    <Content {...props}>
      {description && (
        <p className="lucent-lead" dangerouslySetInnerHTML={{ __html: inlineHtml(description) }} />
      )}
      {children}
    </Content>
  );
}
