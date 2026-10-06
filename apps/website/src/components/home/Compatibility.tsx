import Link from "@docusaurus/Link";

/** The two kinds of app Lucent fits into. */
export function Compatibility() {
  return (
    <section className="compatibility wrap" aria-label="Platform compatibility">
      <div className="compat-heading">
        <h2>Fits the app you already have.</h2>
        <Link to="/docs/guides/install/">Find your setup ↗</Link>
      </div>
      <div className="compat-line">
        <div className="compat-brand">
          <span className="brand-icon brand-react" aria-hidden="true" />
          <div>
            <strong>React Native</strong>
            <span>Bare applications</span>
          </div>
        </div>
        <div className="compat-brand">
          <span className="brand-icon brand-expo" aria-hidden="true" />
          <div>
            <strong>Expo</strong>
            <span>Development builds</span>
          </div>
        </div>
      </div>
    </section>
  );
}
