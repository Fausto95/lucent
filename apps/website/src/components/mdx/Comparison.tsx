/**
 * Lucent next to Expo Modules, Nitro and Turbo Native Modules
 * (docs/comparison-table.ts): one column per tool, each attribute a labelled
 * band, so it fits the docs column; on phones the others scroll past a
 * pinned Lucent column. `compact` (the homepage) shows the summary rows
 * without details.
 */
import { clsx } from "clsx";
import { comparisonRows, type Tone, tools } from "../../docs/comparison-table";
import { inlineHtml } from "../../docs/inline-html";

const toneLabels: Record<Tone, string> = {
  available: "available",
  partial: "partial",
  planned: "planned",
};

export default function Comparison({ compact = false }: { compact?: boolean }) {
  const rows = compact ? comparisonRows.filter((row) => row.summary) : comparisonRows;

  return (
    <div className="comparison" role="region" aria-label="Comparison" tabIndex={0}>
      <table>
        <thead>
          <tr>
            {tools.map((tool) => (
              <th key={tool.id} scope="col" className={clsx({ lucent: tool.id === "lucent" })}>
                {tool.name}
              </th>
            ))}
          </tr>
        </thead>
        {rows.map((row) => (
          <tbody key={row.label}>
            <tr className="band">
              <th scope="rowgroup" className="lucent">
                {row.label}
              </th>
              {tools.slice(1).map((tool) => (
                <td key={tool.id} aria-hidden="true" />
              ))}
            </tr>
            <tr>
              {tools.map((tool) => {
                const cell = row.cells[tool.id];
                return (
                  <td key={tool.id} className={clsx({ lucent: tool.id === "lucent" })}>
                    <span className="value">
                      {cell.tone && (
                        <span
                          className={clsx("dot", cell.tone)}
                          role="img"
                          aria-label={toneLabels[cell.tone]}
                        />
                      )}
                      {cell.value}
                    </span>
                    {!compact && cell.detail && (
                      <span
                        className="detail"
                        dangerouslySetInnerHTML={{ __html: inlineHtml(cell.detail) }}
                      />
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
