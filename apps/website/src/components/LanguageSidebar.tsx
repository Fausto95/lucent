import * as stylex from "@stylexjs/stylex";
import { styles } from "./LanguageSidebar.stylex";
import { SectionSidebar } from "./SectionSidebar";

import { nativeSections } from "../nativeExamples";

const sections = [
  { id: "overview", title: "Overview" },
  { id: "modules", title: "Modules & functions" },
  { id: "types", title: "Types" },
  ...nativeSections.map(({ id, title }) => ({ id, title })),
  { id: "control-flow", title: "Control flow" },
  { id: "expressions", title: "Expressions" },
  { id: "async-errors", title: "Async & errors" },
  { id: "semantics", title: "Runtime semantics" },
  { id: "diagnostics", title: "Diagnostics" },
];

export function LanguageSidebar() {
  return (
    <SectionSidebar
      to="/language/"
      label="Language reference"
      sections={sections}
      footer={
        <div {...stylex.props(styles.referenceVersion)}>
          <span {...stylex.props(styles.referenceVersionNumber)}>AOT</span> Swift + Kotlin
        </div>
      }
    />
  );
}
