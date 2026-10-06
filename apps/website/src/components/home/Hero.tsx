import Link from "@docusaurus/Link";
import { CodeSample } from "./CodeSample";
import { squareCall, squareSource } from "./samples";

/** The headline, the two calls to action, and the smallest whole example. */
export function Hero() {
  return (
    <header className="hero wrap">
      <div className="eyebrow mono">TYPESCRIPT → NATIVE CODE</div>
      <div className="beam" aria-hidden="true">
        <i />
        <i />
        <i />
        <i />
        <i />
      </div>
      <h1>
        Write TypeScript.
        <br />
        <em>Run native.</em>
      </h1>

      <div className="hero-bottom">
        <p className="intro">
          Native logic and views for React Native, written in TypeScript. From compiled functions to
          SwiftUI and Jetpack Compose.
        </p>
        <div className="actions">
          <Link className="cta" to="/docs/guides/install/">
            Start building <span>↗</span>
          </Link>
          <Link to="/docs/architecture/">How it works →</Link>
        </div>
      </div>

      <div className="codebox hero-code">
        <div className="codepane">
          <div className="code-label mono">
            <span>YOU WRITE</span>
            <span>math.lucent.ts</span>
          </div>
          <CodeSample tokens={squareSource} />
        </div>
        <div className="codepane">
          <div className="code-label mono">
            <span>YOUR APP CALLS</span>
            <span>App.tsx</span>
          </div>
          <CodeSample tokens={squareCall} />
        </div>
      </div>
    </header>
  );
}
