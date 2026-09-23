import * as stylex from "@stylexjs/stylex";
import { useState, type KeyboardEvent } from "react";
import { styles } from "./CompilerDemo.stylex";
import { demoCpp, demoSource } from "../generated/compiler-demo";
import { appUsage } from "../content";
import { HighlightedCode } from "./HighlightedCode";
import { useClipboard } from "./ClipboardProvider";

/** The output tabs, in order. The C++ is the compiler's real output (scripts/website.ts). */
const outputs = [
  { id: "cpp", symbol: "C++", label: "Generated C++", file: "m_geo.cpp", code: demoCpp, footer: "Compiled by Xcode and Gradle" },
  { id: "app", symbol: "JS", label: "Your app", file: "App.tsx", code: appUsage, footer: "A synchronous call over JSI" },
] as const;

export function CompilerDemo() {
  const [index, setIndex] = useState(0);
  const { copy } = useClipboard();
  const output = outputs[index]!;
  function select(next: number) {
    setIndex(next);
    document.getElementById(`demo-tab-${outputs[next]!.id}`)?.focus();
  }
  function handleTabKey(event: KeyboardEvent<HTMLButtonElement>) {
    const last = outputs.length - 1;
    const moves: Record<string, number> = {
      ArrowLeft: index === 0 ? last : index - 1,
      ArrowRight: index === last ? 0 : index + 1,
      Home: 0,
      End: last,
    };
    const next = moves[event.key];
    if (next === undefined) return;
    event.preventDefault();
    select(next);
  }
  return (
    <div aria-label="An example of Lucent's generated native code" {...stylex.props(styles.compilerDemo)}>
      <div {...stylex.props(styles.demoTopline)}>
        <span {...stylex.props(styles.demoToplineLabel)}>{"ONE TYPESCRIPT MODULE. REAL C++."}</span>
        <span {...stylex.props(styles.demoIndex)}>{`0${index + 1} / 0${outputs.length}`}</span>
      </div>
      <div {...stylex.props(styles.codeWindow)}>
        <div {...stylex.props(styles.windowBar)}>
          <span {...stylex.props(styles.fileLabel)}>
            <span {...stylex.props(styles.languageIcon)}>{"TS"}</span>
            {"geo.lucent.ts"}
          </span>
          <button
            onClick={() => copy(demoSource)}
            aria-label="Copy TypeScript example"
            title="Copy TypeScript example"
            {...stylex.props(styles.iconButton)}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true" {...stylex.props(styles.copyIcon)}>
              <rect x="8" y="8" width="11" height="12" rx="2"></rect>
              <path d="M15 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h3"></path>
            </svg>
          </button>
        </div>
        <pre {...stylex.props(styles.sourceCode)}>
          <HighlightedCode code={demoSource} />
        </pre>
      </div>
      <div {...stylex.props(styles.compileConnector)}>
        <span {...stylex.props(styles.connectorLine)}></span>
        <span {...stylex.props(styles.compileLabel)}>
          <span aria-hidden="true" {...stylex.props(styles.compileArrow)}>
            {"↓"}
          </span>
          {" lucent build"}
        </span>
        <span {...stylex.props(styles.connectorLine)}></span>
      </div>
      <div {...stylex.props(styles.outputWindow)}>
        <div {...stylex.props(styles.outputWindowBar)}>
          <div role="tablist" aria-label="Output" {...stylex.props(styles.languageTabs)}>
            {outputs.map((tab, i) => (
              <button
                key={tab.id}
                aria-selected={i === index}
                tabIndex={i === index ? 0 : -1}
                onClick={() => setIndex(i)}
                onKeyDown={handleTabKey}
                id={`demo-tab-${tab.id}`}
                role="tab"
                aria-controls="demo-output"
                {...stylex.props(styles.languageTab, i === index && styles.selectedTab)}
              >
                <span aria-hidden="true" {...stylex.props(styles.tabSymbol)}>
                  {tab.symbol}
                </span>
                {tab.label}
              </button>
            ))}
          </div>
          <span {...stylex.props(styles.outputLabel)}>{output.file}</span>
        </div>
        <pre
          aria-labelledby={`demo-tab-${output.id}`}
          id="demo-output"
          role="tabpanel"
          tabIndex={0}
          {...stylex.props(styles.generatedCode)}
        >
          <HighlightedCode code={output.code} />
        </pre>
        <div {...stylex.props(styles.outputFooter)}>
          <span>
            <span aria-hidden="true" {...stylex.props(styles.check)}>
              {"✓"}
            </span>
            {` ${output.footer}`}
          </span>
        </div>
      </div>
      <p {...stylex.props(styles.demoCaption)}>
        {"The C++ is the compiler’s actual output, checked against the compiler in CI."}
      </p>
    </div>
  );
}
