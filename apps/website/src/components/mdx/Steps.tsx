/** A procedure: an ordered list whose items start with a ### heading, numbered down a rail. */
import type { ReactNode } from "react";

export default function Steps({ children }: { children: ReactNode }) {
  return <div className="lucent-steps">{children}</div>;
}
