/** One tab of <Tabs>: Tabs reads its label and shows its content. */
import type { ReactNode } from "react";

export interface TabItemProps {
  label: string;
  children: ReactNode;
}

export default function TabItem({ children }: TabItemProps) {
  return <>{children}</>;
}
