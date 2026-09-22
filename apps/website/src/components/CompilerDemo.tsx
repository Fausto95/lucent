import * as stylex from "@stylexjs/stylex";
import { useState, type KeyboardEvent } from "react";
import { styles } from "./CompilerDemo.stylex";
import { styles as sharedStyles } from "../styles/shared.stylex";
import { examples, source } from "../content";
import { HighlightedCode } from "./HighlightedCode";
import { useClipboard } from "./ClipboardProvider";

export function CompilerDemo() {
  const [language, setLanguage] = useState<keyof typeof examples>("swift");
  const { copy } = useClipboard();
  const example = examples[language];
  function handleTabKey(event: KeyboardEvent<HTMLButtonElement>) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const next =
      event.key === "Home" ? "swift" : event.key === "End" ? "kotlin" : language === "swift" ? "kotlin" : "swift";
    setLanguage(next);
    document.getElementById(`tab-${next}`)?.focus();
  }
  return (
    <div aria-label="An example of Lucent's generated native code" {...stylex.props(styles.compilerDemo)}>
      <div {...stylex.props(styles.demoTopline)}>
        <span {...stylex.props(styles.demoToplineLabel)}>{"ONE SOURCE. TWO PLATFORMS."}</span>
        <span {...stylex.props(styles.demoIndex)}>{language === "swift" ? "01 / 02" : "02 / 02"}</span>
      </div>
      <div {...stylex.props(styles.codeWindow)}>
        <div {...stylex.props(styles.windowBar)}>
          <span {...stylex.props(styles.fileLabel)}>
            <span {...stylex.props(styles.languageIcon)}>{"TS"}</span>
            {"clamp.lucent.ts"}
          </span>
          <button
            onClick={() => copy(source)}
            id="copy-code"
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
          <code>
            <span {...stylex.props(styles.line)}>
              <span aria-hidden="true" {...stylex.props(styles.codeNumber)}>
                1
              </span>
              <span {...stylex.props(styles.purple)}>{"export function"}</span>{" "}
              <span {...stylex.props(sharedStyles.brandPeriod)}>{"clamp"}</span>
              {"("}
            </span>
            <span {...stylex.props(styles.line)}>
              <span aria-hidden="true" {...stylex.props(styles.codeNumber)}>
                2
              </span>
              {"  value: "}
              <span {...stylex.props(styles.yellow)}>{"number"}</span>
              {","}
            </span>
            <span {...stylex.props(styles.line)}>
              <span aria-hidden="true" {...stylex.props(styles.codeNumber)}>
                3
              </span>
              {"  min: "}
              <span {...stylex.props(styles.yellow)}>{"number"}</span>
              {","}
            </span>
            <span {...stylex.props(styles.line)}>
              <span aria-hidden="true" {...stylex.props(styles.codeNumber)}>
                4
              </span>
              {"  max: "}
              <span {...stylex.props(styles.yellow)}>{"number"}</span>
            </span>
            <span {...stylex.props(styles.line)}>
              <span aria-hidden="true" {...stylex.props(styles.codeNumber)}>
                5
              </span>
              {"): "}
              <span {...stylex.props(styles.yellow)}>{"number"}</span>
              {" {"}
            </span>
            <span {...stylex.props(styles.line)}>
              <span aria-hidden="true" {...stylex.props(styles.codeNumber)}>
                6
              </span>
              {"  "}
              <span {...stylex.props(styles.purple)}>{"if"}</span>
              {" (value < min) "}
              <span {...stylex.props(styles.purple)}>{"return"}</span>
              {" min;"}
            </span>
            <span {...stylex.props(styles.line)}>
              <span aria-hidden="true" {...stylex.props(styles.codeNumber)}>
                7
              </span>
              {"  "}
              <span {...stylex.props(styles.purple)}>{"if"}</span>
              {" (value > max) "}
              <span {...stylex.props(styles.purple)}>{"return"}</span>
              {" max;"}
            </span>
            <span {...stylex.props(styles.line)}>
              <span aria-hidden="true" {...stylex.props(styles.codeNumber)}>
                8
              </span>
              {"  "}
              <span {...stylex.props(styles.purple)}>{"return"}</span>
              {" value;"}
            </span>
            <span {...stylex.props(styles.line)}>
              <span aria-hidden="true" {...stylex.props(styles.codeNumber)}>
                9
              </span>
              {"}"}
            </span>
          </code>
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
          <div role="tablist" aria-label="Generated language" {...stylex.props(styles.languageTabs)}>
            <button
              aria-selected={language === "swift"}
              tabIndex={language === "swift" ? 0 : -1}
              onClick={() => setLanguage("swift")}
              onKeyDown={handleTabKey}
              id="tab-swift"
              role="tab"
              aria-controls="generated-code"
              {...stylex.props(styles.languageTab, language === "swift" && styles.selectedTab)}
            >
              <span aria-hidden="true" {...stylex.props(styles.tabSymbol)}>
                {"S"}
              </span>
              {"Swift"}
            </button>
            <button
              aria-selected={language === "kotlin"}
              tabIndex={language === "kotlin" ? 0 : -1}
              onClick={() => setLanguage("kotlin")}
              onKeyDown={handleTabKey}
              id="tab-kotlin"
              role="tab"
              aria-controls="generated-code"
              {...stylex.props(styles.languageTab, language === "kotlin" && styles.selectedTab)}
            >
              <span aria-hidden="true" {...stylex.props(styles.tabSymbol2)}>
                {"K"}
              </span>
              {"Kotlin"}
            </button>
          </div>
          <span id="platform-label" {...stylex.props(styles.outputLabel)}>
            {example.platform}
          </span>
        </div>
        <pre
          aria-labelledby={`tab-${language}`}
          id="generated-code"
          role="tabpanel"
          tabIndex={0}
          {...stylex.props(styles.generatedCode)}
        >
          <HighlightedCode code={example.code} />
        </pre>
        <div {...stylex.props(styles.outputFooter)}>
          <span>
            <span aria-hidden="true" {...stylex.props(styles.check)}>
              {"✓"}
            </span>
            {" Ahead-of-time compiled"}
          </span>
          <span>{example.extension}</span>
        </div>
      </div>
      <p {...stylex.props(styles.demoCaption)}>{"Real native source. Ready for your platform’s toolchain."}</p>
    </div>
  );
}
