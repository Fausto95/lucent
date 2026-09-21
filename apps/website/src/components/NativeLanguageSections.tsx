import * as stylex from "@stylexjs/stylex";
import { styles } from "../pages/LanguagePage.stylex";
import { nativeSections } from "../nativeExamples";
import { CodeBlock } from "./CodeBlock";

export function NativeLanguageSections() {
  return nativeSections.map((section) => (
    <section key={section.id} id={section.id} {...stylex.props(styles.referenceSection)}>
      <div {...stylex.props(styles.referenceSectionLabel)}>{section.label}</div>
      <h2 {...stylex.props(styles.referenceSectionHeading)}>{section.title}</h2>
      <p {...stylex.props(styles.referenceParagraph)}>{section.description}</p>
      {section.examples.map((example) => (
        <CodeBlock key={example.filename} {...example} />
      ))}
      <p {...stylex.props(styles.referenceParagraph)}>{section.detail}</p>
      <p {...stylex.props(styles.referenceCaveat)}>{section.limit}</p>
    </section>
  ));
}
