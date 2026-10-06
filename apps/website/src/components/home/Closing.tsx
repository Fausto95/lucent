import Link from "@docusaurus/Link";
import { CodeSample } from "./CodeSample";
import { install } from "./samples";

/** The closing band: the two commands that start a project. */
export function Closing() {
  return (
    <section className="closing wrap">
      <div>
        <p className="kicker mono">YOUR LOGIC. YOUR VIEWS. YOUR LANGUAGE.</p>
        <h2>
          Let’s make
          <br />
          it native.
        </h2>
      </div>
      <div>
        <div className="terminal">
          <p className="mono">TERMINAL</p>
          <CodeSample tokens={install} />
        </div>
        <div className="setup">
          <span>Node 22.12+ · Native development build</span>
          <Link to="/docs/guides/install/">Full setup →</Link>
        </div>
      </div>
    </section>
  );
}
