/**
 * What every docs page and post can use without importing it: the
 * components of the docs block model (src/docs/types.ts). Code blocks are
 * Expressive Code's (docusaurus.config.ts): its <pre> and <code> render as
 * they are, never as Docusaurus' own code block.
 */
import MDXComponents from "@theme-original/MDXComponents";
import type { ComponentProps } from "react";
import CardGrid from "../components/mdx/CardGrid";
import Comparison from "../components/mdx/Comparison";
import Diagram from "../components/mdx/Diagram";
import LinkCard from "../components/mdx/LinkCard";
import Steps from "../components/mdx/Steps";
import Table from "../components/mdx/Table";
import TabItem from "../components/mdx/TabItem";
import Tabs from "../components/mdx/Tabs";

/** Inline code keeps Docusaurus' look; a block's code is already Expressive Code's markup. */
function Code(props: ComponentProps<"code">) {
  return typeof props.children === "string" ? (
    <MDXComponents.code {...props} />
  ) : (
    <code {...props} />
  );
}

export default {
  ...MDXComponents,
  pre: (props: ComponentProps<"pre">) => <pre {...props} />,
  code: Code,
  table: Table,
  Tabs,
  TabItem,
  Steps,
  CardGrid,
  LinkCard,
  Diagram,
  Comparison,
};
