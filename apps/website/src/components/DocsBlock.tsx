import * as stylex from "@stylexjs/stylex";
import { type Block, headingId } from "../docs/types";
import { styles } from "./DocsContent.stylex";
import { CodeBlock } from "./CodeBlock";
import { CodeTabs } from "./CodeTabs";
import { ComparisonTable } from "./ComparisonTable";
import { DocsDiagram } from "./DocsDiagram";
import { DocsHeading } from "./DocsHeading";
import { DocsPanels } from "./DocsPanels";
import { Inline } from "./Inline";
import { SeeCpp } from "./SeeCpp";
import { SmartLink } from "./SmartLink";

/** Renders one docs block. Pages are arrays of these; see docs/types.ts. */
export function DocsBlock({ block }: { block: Block }) {
  switch (block.kind) {
    case "p":
      return (
        <p {...stylex.props(styles.paragraph)}>
          <Inline text={block.text} />
        </p>
      );
    case "h2":
      return <DocsHeading level={2} text={block.text} />;
    case "h3":
      return <DocsHeading level={3} text={block.text} />;
    case "code":
      return (
        <>
          <CodeBlock
            filename={block.filename}
            code={block.code}
            copyable={block.copy !== false}
            diff={block.diff === true}
          />
          {block.cpp && <SeeCpp filename={block.filename} />}
        </>
      );
    case "tabs":
      return (
        <>
          <CodeTabs tabs={block.tabs} />
          {block.tabs
            .filter((t) => t.cpp)
            .map((t) => (
              <SeeCpp key={t.filename} filename={t.filename} />
            ))}
        </>
      );
    case "note": {
      const warn = block.tone === "warn";
      return (
        <div role="note" {...stylex.props(styles.note, warn && styles.noteWarn)}>
          <span aria-hidden="true" {...stylex.props(styles.noteMark, warn && styles.noteMarkWarn)}>
            {warn ? "!" : "↳"}
          </span>
          <p {...stylex.props(styles.noteText)}>
            <Inline text={block.text} />
          </p>
        </div>
      );
    }
    case "list": {
      const Tag = block.ordered ? "ol" : "ul";
      return (
        <Tag {...stylex.props(styles.list)}>
          {block.items.map((item) => (
            <li key={item} {...stylex.props(styles.listItem)}>
              <Inline text={item} />
            </li>
          ))}
        </Tag>
      );
    }
    case "table":
      return (
        <div role="region" tabIndex={0} {...stylex.props(styles.tableWrap)}>
          <table {...stylex.props(styles.table)}>
            <thead>
              <tr>
                {block.head.map((cell) => (
                  <th key={cell} scope="col" {...stylex.props(styles.th)}>
                    {cell}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row) => (
                <tr key={row.join("|")}>
                  {row.map((cell, i) => (
                    <td key={i} {...stylex.props(styles.td, i === 0 && styles.tdFirst)}>
                      <Inline text={cell} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "diagram":
      return (
        <figure {...stylex.props(styles.diagram)}>
          <DocsDiagram name={block.diagram} />
          {block.caption && (
            <figcaption {...stylex.props(styles.caption)}>
              <Inline text={block.caption} />
            </figcaption>
          )}
        </figure>
      );
    case "comparison":
      return <ComparisonTable />;
    case "steps":
      return (
        <ol {...stylex.props(styles.steps)}>
          {block.steps.map((step, i) => (
            <li key={step.title} {...stylex.props(styles.step)}>
              <h3 id={headingId(step.title)} {...stylex.props(styles.stepTitle)}>
                <span aria-hidden="true" {...stylex.props(styles.stepNumber)}>
                  {i + 1}
                </span>
                <Inline text={step.title} />
              </h3>
              {step.blocks.map((inner, j) => (
                <DocsBlock key={j} block={inner} />
              ))}
            </li>
          ))}
        </ol>
      );
    case "panels":
      return <DocsPanels panels={block.panels} />;
    case "cards":
      return (
        <div {...stylex.props(styles.cards)}>
          {block.items.map((item) => (
            <SmartLink key={item.href} href={item.href} {...stylex.props(styles.card)}>
              <p {...stylex.props(styles.cardTitle)}>
                {item.title}
                <span aria-hidden="true" {...stylex.props(styles.cardArrow)}>
                  →
                </span>
              </p>
              <p {...stylex.props(styles.cardText)}>{item.text}</p>
            </SmartLink>
          ))}
        </div>
      );
  }
}
