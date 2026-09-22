import { Link } from "@tanstack/react-router";
import type { CSSProperties, ReactNode } from "react";

interface SmartLinkProps {
  href: string;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}

/** Internal hrefs go through the router so navigation stays client-side; hashes are preserved. */
export function SmartLink({ href, children, className, style }: SmartLinkProps) {
  if (!href.startsWith("/")) {
    return (
      <a href={href} className={className} style={style}>
        {children}
      </a>
    );
  }
  const [path, hash] = href.split("#") as [string, string | undefined];
  if (path.startsWith("/docs")) {
    const splat = path.slice("/docs".length).replace(/^\/|\/$/g, "");
    return (
      <Link to="/docs/$/" params={{ _splat: splat }} hash={hash} className={className} style={style}>
        {children}
      </Link>
    );
  }
  return (
    <Link to="/" hash={hash} className={className} style={style}>
      {children}
    </Link>
  );
}
