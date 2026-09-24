import * as stylex from "@stylexjs/stylex";
import { useState } from "react";
import type { Block } from "../docs/types";
import { styles } from "./DocsContent.stylex";
import { DocsBlock } from "./DocsBlock";

const KEY = "lucent-docs-panel";

/** Tabs of alternative instructions. The last label picked is remembered, so Install and the next pages agree. */
export function DocsPanels({ panels }: { panels: { label: string; blocks: Block[] }[] }) {
  const [label, setLabel] = useState(() => localStorage.getItem(KEY));
  const current = panels.find((p) => p.label === label) ?? panels[0]!;
  return (
    <section {...stylex.props(styles.panels)}>
      <div role="tablist" aria-label="Setup" {...stylex.props(styles.panelsBar)}>
        {panels.map((panel) => (
          <button
            key={panel.label}
            type="button"
            role="tab"
            aria-selected={panel === current}
            onClick={() => {
              localStorage.setItem(KEY, panel.label);
              setLabel(panel.label);
            }}
            {...stylex.props(styles.tab, panel === current && styles.tabSelected)}
          >
            {panel.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" aria-label={current.label}>
        {current.blocks.map((block, i) => (
          <DocsBlock key={`${current.label}-${i}`} block={block} />
        ))}
      </div>
    </section>
  );
}
