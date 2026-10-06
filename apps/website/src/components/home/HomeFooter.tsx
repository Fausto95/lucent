import Link from "@docusaurus/Link";
import { Logo } from "./Logo";

/** The homepage's own footer. */
export function HomeFooter() {
  return (
    <footer className="wrap">
      <Logo />
      <span className="tag">Native logic. Native views. TypeScript.</span>
      <div className="links">
        <Link to="/docs/">Docs</Link>
        <Link to="/docs/guides/port-an-expo-module/">Examples</Link>
        <Link to="/blog/">Blog ↗</Link>
      </div>
    </footer>
  );
}
