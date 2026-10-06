/** Where to go next: LinkCards in a grid. */
import type { ReactNode } from "react";

export default function CardGrid({ children }: { children: ReactNode }) {
  return <div className="lucent-card-grid">{children}</div>;
}
