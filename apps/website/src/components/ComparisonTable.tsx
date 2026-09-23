import * as stylex from "@stylexjs/stylex";
import { comparisonRows, tools, type Tone } from "../docs/comparison-table";
import { styles } from "./ComparisonTable.stylex";
import { Inline } from "./Inline";

const toneStyles = { available: styles.dotAvailable, partial: styles.dotPartial, planned: styles.dotPlanned };
const toneLabels: Record<Tone, string> = { available: "available", partial: "partial", planned: "planned" };

/**
 * Lucent next to Expo Modules, Nitro and Turbo Native Modules: one column
 * per tool, each attribute a labelled band, so it fits the docs column
 * without scrolling; on phones the others scroll past a pinned Lucent
 * column. `compact` (the homepage) shows the summary rows without details.
 */
export function ComparisonTable({ compact = false }: { compact?: boolean }) {
  const rows = compact ? comparisonRows.filter((row) => row.summary) : comparisonRows;
  return (
    <div role="region" aria-label="Comparison" tabIndex={0} {...stylex.props(styles.wrap)}>
      <table {...stylex.props(styles.table)}>
        <colgroup>
          {tools.map((tool) => (
            <col key={tool.id} {...stylex.props(tool.id === "lucent" && styles.columnLucent)} />
          ))}
        </colgroup>
        <thead>
          <tr>
            {tools.map((tool) => (
              <th key={tool.id} scope="col" {...stylex.props(styles.head, tool.id === "lucent" && [styles.pinned, styles.headLucent])}>
                {tool.name}
              </th>
            ))}
          </tr>
        </thead>
        {rows.map((row) => (
          <tbody key={row.label}>
            <tr>
              {/* Four cells, not a colSpan: a spanning cell would take the Lucent column's tint. */}
              <th scope="rowgroup" {...stylex.props(styles.pinned, styles.label)}>
                {row.label}
              </th>
              {tools.slice(1).map((tool) => (
                <td key={tool.id} aria-hidden="true" {...stylex.props(styles.labelRest)} />
              ))}
            </tr>
            <tr>
              {tools.map((tool) => {
                const cell = row.cells[tool.id];
                return (
                  <td key={tool.id} {...stylex.props(styles.cell, tool.id === "lucent" && styles.pinned)}>
                    <span {...stylex.props(styles.value)}>
                      {cell.tone && (
                        <span role="img" aria-label={toneLabels[cell.tone]} {...stylex.props(styles.dot, toneStyles[cell.tone])} />
                      )}
                      {cell.value}
                    </span>
                    {!compact && cell.detail && (
                      <span {...stylex.props(styles.detail)}>
                        <Inline text={cell.detail} />
                      </span>
                    )}
                  </td>
                );
              })}
            </tr>
          </tbody>
        ))}
      </table>
    </div>
  );
}
