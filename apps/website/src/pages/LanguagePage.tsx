import * as stylex from "@stylexjs/stylex";
import { Link } from "@tanstack/react-router";
import { styles } from "./LanguagePage.stylex";
import { styles as sharedStyles } from "../styles/shared.stylex";
import { CodeBlock } from "../components/CodeBlock";
import { LanguageSidebar } from "../components/LanguageSidebar";
export function LanguagePage() {
  return (
    <div {...stylex.props(styles.referenceLayout)}>
      <LanguageSidebar />
      <main id="main" {...stylex.props(styles.referenceMain)}>
        <section id="overview" {...stylex.props(styles.referenceIntro)}>
          <div {...stylex.props(styles.referenceKicker)}>
            <span {...stylex.props(sharedStyles.eyebrow2)}>{"TYPESCRIPT, WITH INTENTION."}</span>
            <span {...stylex.props(styles.versionBadge)}>{"LANGUAGE v1"}</span>
          </div>
          <h1 {...stylex.props(styles.referenceHeading)}>
            {"The Lucent "}
            <span {...stylex.props(styles.referenceHeadingAccent)}>{"language."}</span>
          </h1>
          <p {...stylex.props(styles.referenceLead)}>
            {
              "A focused subset of TypeScript that compiles to Swift and Kotlin. Familiar syntax. Explicit boundaries. Native execution."
            }
          </p>
          <div {...stylex.props(styles.referenceNote)}>
            <span aria-hidden="true" {...stylex.props(styles.noteMark)}>
              {"↳"}
            </span>
            <p {...stylex.props(styles.referenceNoteText)}>
              {"Each "}
              <code {...stylex.props(styles.referenceInlineCode)}>{"*.lucent.ts"}</code>
              {" file is a native module. Its code is compiled ahead of time and never runs in a JavaScript engine."}
            </p>
          </div>
          <p {...stylex.props(styles.referenceParagraph)}>
            {
              "Use this reference to see what you can write, how types map to each platform, and what the compiler checks before your code ships."
            }
          </p>
        </section>
        <section id="modules" {...stylex.props(styles.referenceSection)}>
          <div {...stylex.props(styles.referenceSectionLabel)}>{"01 / THE BASICS"}</div>
          <h2 {...stylex.props(styles.referenceSectionHeading)}>{"Modules & functions"}</h2>
          <p {...stylex.props(styles.referenceParagraph)}>
            {
              "Export a function to make it part of your module’s native API. Keep a function unexported to use it as a private helper. Parameters and return types need explicit annotations; local variables can be inferred."
            }
          </p>
          <CodeBlock
            filename="clamp.lucent.ts"
            code={
              "export function clamp(value: number, min: number, max: number): number {\n  if (value < min) {\n    return min;\n  }\n  if (value > max) {\n    return max;\n  }\n  return value;\n}"
            }
          />
          <ul {...stylex.props(styles.referenceList)}>
            <li {...stylex.props(styles.referenceListItem)}>
              {"Use "}
              <code {...stylex.props(styles.referenceInlineCode)}>{"export function"}</code>
              {" or "}
              <code {...stylex.props(styles.referenceInlineCode)}>{"export async function"}</code>
              {" for public functions."}
            </li>
            <li {...stylex.props(styles.referenceListItem)}>
              {"Declare structs with "}
              <code {...stylex.props(styles.referenceInlineCode)}>{"type Name = { … }"}</code>
              {". Struct types may be exported or private."}
            </li>
            <li {...stylex.props(styles.referenceListItem)}>
              {"Functions accept up to "}
              <strong {...stylex.props(styles.referenceStrong)}>{"8 parameters"}</strong>
              {"."}
            </li>
            <li {...stylex.props(styles.referenceListItem)}>
              {"The only allowed import is "}
              <code {...stylex.props(styles.referenceInlineCode)}>{'import type { … } from "@lucent-lang/types"'}</code>
              {"."}
            </li>
          </ul>
          <p {...stylex.props(styles.referenceCaveat)}>
            {
              "At the top level, only function declarations, object type aliases, and the permitted type import are supported. Top-level statements, constants, classes, and default exports are rejected."
            }
          </p>
        </section>
        <section id="types" {...stylex.props(styles.referenceSection)}>
          <div {...stylex.props(styles.referenceSectionLabel)}>{"02 / NATIVE BY CONSTRUCTION"}</div>
          <h2 {...stylex.props(styles.referenceSectionHeading)}>{"Types that travel"}</h2>
          <p {...stylex.props(styles.referenceParagraph)}>
            {
              "Every supported type has a native representation. Lucent checks types before it generates code for either platform."
            }
          </p>
          <div
            role="region"
            aria-label="TypeScript to native type mappings"
            tabIndex={0}
            {...stylex.props(styles.referenceTable)}
          >
            <table {...stylex.props(styles.typeMappingTable)}>
              <thead>
                <tr>
                  <th scope="col" {...stylex.props(styles.typeMappingHeading)}>
                    {"TypeScript"}
                  </th>
                  <th scope="col" {...stylex.props(styles.tableHeading)}>
                    {"Native type"}
                  </th>
                  <th scope="col" {...stylex.props(styles.tableHeading)}>
                    {"Swift"}
                  </th>
                  <th scope="col" {...stylex.props(styles.tableHeading)}>
                    {"Kotlin"}
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td {...stylex.props(styles.tableLabelCell)}>
                    <code {...stylex.props(styles.tableCode)}>{"number"}</code>
                  </td>
                  <td {...stylex.props(styles.tableCell)}>
                    <code {...stylex.props(styles.tableCode)}>{"float64"}</code>
                  </td>
                  <td {...stylex.props(styles.tableCell)}>
                    <code {...stylex.props(styles.tableCode)}>{"Double"}</code>
                  </td>
                  <td {...stylex.props(styles.tableCell)}>
                    <code {...stylex.props(styles.tableCode)}>{"Double"}</code>
                  </td>
                </tr>
                <tr>
                  <td {...stylex.props(styles.tableLabelCell)}>
                    <code {...stylex.props(styles.tableCode)}>{"string"}</code>
                  </td>
                  <td {...stylex.props(styles.tableCell)}>
                    <code {...stylex.props(styles.tableCode)}>{"string"}</code>
                  </td>
                  <td {...stylex.props(styles.tableCell)}>
                    <code {...stylex.props(styles.tableCode)}>{"String"}</code>
                  </td>
                  <td {...stylex.props(styles.tableCell)}>
                    <code {...stylex.props(styles.tableCode)}>{"String"}</code>
                  </td>
                </tr>
                <tr>
                  <td {...stylex.props(styles.tableLabelCell)}>
                    <code {...stylex.props(styles.tableCode)}>{"boolean"}</code>
                  </td>
                  <td {...stylex.props(styles.tableCell)}>
                    <code {...stylex.props(styles.tableCode)}>{"bool"}</code>
                  </td>
                  <td {...stylex.props(styles.tableCell)}>
                    <code {...stylex.props(styles.tableCode)}>{"Bool"}</code>
                  </td>
                  <td {...stylex.props(styles.tableCell)}>
                    <code {...stylex.props(styles.tableCode)}>{"Boolean"}</code>
                  </td>
                </tr>
                <tr>
                  <td {...stylex.props(styles.tableLabelCell)}>
                    <code {...stylex.props(styles.tableCode)}>{"void"}</code>
                  </td>
                  <td {...stylex.props(styles.tableCell)}>
                    <code {...stylex.props(styles.tableCode)}>{"void"}</code>
                  </td>
                  <td {...stylex.props(styles.tableCell)}>
                    <code {...stylex.props(styles.tableCode)}>{"Void"}</code>
                  </td>
                  <td {...stylex.props(styles.tableCell)}>
                    <code {...stylex.props(styles.tableCode)}>{"Unit"}</code>
                  </td>
                </tr>
                <tr>
                  <td {...stylex.props(styles.tableLabelCell)}>
                    <code {...stylex.props(styles.tableCode)}>{"T[]"}</code>
                    {", "}
                    <code {...stylex.props(styles.tableCode)}>{"Array<T>"}</code>
                  </td>
                  <td {...stylex.props(styles.tableCell)}>
                    <code {...stylex.props(styles.tableCode)}>{"array<T>"}</code>
                  </td>
                  <td {...stylex.props(styles.tableCell)}>
                    <code {...stylex.props(styles.tableCode)}>{"[T]"}</code>
                  </td>
                  <td {...stylex.props(styles.tableCell)}>
                    <code {...stylex.props(styles.tableCode)}>{"List<T>"}</code>
                  </td>
                </tr>
                <tr>
                  <td {...stylex.props(styles.tableLabelCell)}>
                    <code {...stylex.props(styles.tableCode)}>{"T | null"}</code>
                    {", "}
                    <code {...stylex.props(styles.tableCode)}>{"T | undefined"}</code>
                  </td>
                  <td {...stylex.props(styles.tableCell)}>
                    <code {...stylex.props(styles.tableCode)}>{"optional<T>"}</code>
                  </td>
                  <td {...stylex.props(styles.tableCell)}>
                    <code {...stylex.props(styles.tableCode)}>{"T?"}</code>
                  </td>
                  <td {...stylex.props(styles.tableCell)}>
                    <code {...stylex.props(styles.tableCode)}>{"T?"}</code>
                  </td>
                </tr>
                <tr>
                  <td {...stylex.props(styles.tableLabelCell)}>
                    <code {...stylex.props(styles.tableCode)}>{"Record<string, T>"}</code>
                  </td>
                  <td {...stylex.props(styles.tableCell)}>
                    <code {...stylex.props(styles.tableCode)}>{"map<T>"}</code>
                  </td>
                  <td {...stylex.props(styles.tableCell)}>
                    <code {...stylex.props(styles.tableCode)}>{"[String: T]"}</code>
                  </td>
                  <td {...stylex.props(styles.tableCell)}>
                    <code {...stylex.props(styles.tableCode)}>{"Map<String, T>"}</code>
                  </td>
                </tr>
                <tr>
                  <td {...stylex.props(styles.tableLabelCell)}>
                    <code {...stylex.props(styles.tableCode)}>{"Uint8Array"}</code>
                  </td>
                  <td {...stylex.props(styles.tableCell)}>
                    <code {...stylex.props(styles.tableCode)}>{"bytes"}</code>
                  </td>
                  <td {...stylex.props(styles.tableCell)}>
                    <code {...stylex.props(styles.tableCode)}>{"ArrayBuffer"}</code>
                  </td>
                  <td {...stylex.props(styles.tableCell)}>
                    <code {...stylex.props(styles.tableCode)}>{"ArrayBuffer"}</code>
                  </td>
                </tr>
                <tr>
                  <td {...stylex.props(styles.tableLabelCell)}>
                    <code {...stylex.props(styles.tableCode)}>{"Promise<T>"}</code>
                    {" (return type only)"}
                  </td>
                  <td {...stylex.props(styles.tableCell)}>
                    <code {...stylex.props(styles.tableCode)}>{"promise<T>"}</code>
                  </td>
                  <td {...stylex.props(styles.tableCell)}>
                    <code {...stylex.props(styles.tableCode)}>{"async … -> T"}</code>
                  </td>
                  <td {...stylex.props(styles.tableCell)}>
                    <code {...stylex.props(styles.tableCode)}>{"suspend …: T"}</code>
                  </td>
                </tr>
                <tr>
                  <td {...stylex.props(styles.tableLabelCell)}>{"object type alias"}</td>
                  <td {...stylex.props(styles.tableCell)}>
                    <code {...stylex.props(styles.tableCode)}>{"struct"}</code>
                  </td>
                  <td {...stylex.props(styles.tableCell)}>
                    <code {...stylex.props(styles.tableCode)}>{"struct"}</code>
                  </td>
                  <td {...stylex.props(styles.tableCell)}>
                    <code {...stylex.props(styles.tableCode)}>{"data class"}</code>
                  </td>
                </tr>
                <tr>
                  <td {...stylex.props(styles.tableLabelCell)}>
                    <code {...stylex.props(styles.tableCode)}>{"int8…int64"}</code>
                    {", "}
                    <code {...stylex.props(styles.tableCode)}>{"uint8…uint64"}</code>
                    {", "}
                    <code {...stylex.props(styles.tableCode)}>{"float32"}</code>
                    {", "}
                    <code {...stylex.props(styles.tableCode)}>{"float64"}</code>
                    {" from "}
                    <code {...stylex.props(styles.tableCode)}>{"@lucent-lang/types"}</code>
                  </td>
                  <td {...stylex.props(styles.tableCell)}>{"sized numerics"}</td>
                  <td {...stylex.props(styles.tableCell)}>
                    <code {...stylex.props(styles.tableCode)}>{"Int32"}</code>
                    {", "}
                    <code {...stylex.props(styles.tableCode)}>{"Float"}</code>
                    {", …"}
                  </td>
                  <td {...stylex.props(styles.tableCell)}>
                    <code {...stylex.props(styles.tableCode)}>{"Int"}</code>
                    {", "}
                    <code {...stylex.props(styles.tableCode)}>{"Float"}</code>
                    {", …"}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <h3 {...stylex.props(styles.referenceSubheading)}>{"Structs & optional values"}</h3>
          <p {...stylex.props(styles.referenceParagraph)}>
            {
              "Object type aliases become Swift structs and Kotlin data classes. Fields can use any supported type except "
            }
            <code {...stylex.props(styles.referenceInlineCode)}>{"Promise"}</code>
            {". Mark a field optional with "}
            <code {...stylex.props(styles.referenceInlineCode)}>{"?"}</code>
            {", or use "}
            <code {...stylex.props(styles.referenceInlineCode)}>{"T | null"}</code>
            {" or "}
            <code {...stylex.props(styles.referenceInlineCode)}>{"T | undefined"}</code>
            {"."}
          </p>
          <CodeBlock
            filename="struct-roundtrip.lucent.ts"
            code={
              'import type { int32 } from "@lucent-lang/types";\n\nexport type User = {\n  id: string;\n  age: int32;\n  nickname?: string;\n  tags: string[];\n};\n\nexport function birthday(user: User): User {\n  return { id: user.id, age: user.age + 1, nickname: user.nickname, tags: user.tags };\n}\n\nexport function describe(user: User): string {\n  const nickname = user.nickname;\n  if (nickname === undefined) {\n    return `${user.id} (${user.age})`;\n  }\n  return `${nickname} aka ${user.id}`;\n}'
            }
          />
          <p {...stylex.props(styles.referenceParagraph)}>
            {"Narrow an optional local or parameter with an explicit "}
            <code {...stylex.props(styles.referenceInlineCode)}>{"=== null"}</code>
            {", "}
            <code {...stylex.props(styles.referenceInlineCode)}>{"!== null"}</code>
            {", or equivalent "}
            <code {...stylex.props(styles.referenceInlineCode)}>{"undefined"}</code>
            {
              " check before using it. An early return works too. Conditions must be booleans; implicit truthiness is not supported."
            }
          </p>
          <h3 {...stylex.props(styles.referenceSubheading)}>{"Explicit numeric types"}</h3>
          <p {...stylex.props(styles.referenceParagraph)}>
            {"Use "}
            <code {...stylex.props(styles.referenceInlineCode)}>{"number"}</code>
            {" for 64-bit floating-point values. Import "}
            <code {...stylex.props(styles.referenceInlineCode)}>{"int8"}</code>
            {" through "}
            <code {...stylex.props(styles.referenceInlineCode)}>{"int64"}</code>
            {", "}
            <code {...stylex.props(styles.referenceInlineCode)}>{"uint8"}</code>
            {" through "}
            <code {...stylex.props(styles.referenceInlineCode)}>{"uint64"}</code>
            {", "}
            <code {...stylex.props(styles.referenceInlineCode)}>{"float32"}</code>
            {", or "}
            <code {...stylex.props(styles.referenceInlineCode)}>{"float64"}</code>
            {" from "}
            <code {...stylex.props(styles.referenceInlineCode)}>{"@lucent-lang/types"}</code>
            {" when you need a specific representation."}
          </p>
          <p {...stylex.props(styles.referenceParagraph)}>
            {"Numeric types never convert implicitly. Mixing "}
            <code {...stylex.props(styles.referenceInlineCode)}>{"int32"}</code>
            {" and "}
            <code {...stylex.props(styles.referenceInlineCode)}>{"number"}</code>
            {" produces "}
            <code {...stylex.props(styles.referenceInlineCode)}>{"NT1011"}</code>
            {". Integer literals adopt the sized type of their context."}
          </p>
          <div {...stylex.props(styles.referenceNote)}>
            <span aria-hidden="true" {...stylex.props(styles.noteMark)}>
              {"!"}
            </span>
            <p {...stylex.props(styles.referenceNoteText)}>
              <code {...stylex.props(styles.referenceInlineCode)}>{"any"}</code>
              {", "}
              <code {...stylex.props(styles.referenceInlineCode)}>{"unknown"}</code>
              {", function types, general unions, tuples, generics, classes, interfaces, enums, "}
              <code {...stylex.props(styles.referenceInlineCode)}>{"never"}</code>
              {", "}
              <code {...stylex.props(styles.referenceInlineCode)}>{"object"}</code>
              {", "}
              <code {...stylex.props(styles.referenceInlineCode)}>{"symbol"}</code>
              {", and "}
              <code {...stylex.props(styles.referenceInlineCode)}>{"bigint"}</code>
              {" are outside the language."}
            </p>
          </div>
        </section>
        <section id="control-flow" {...stylex.props(styles.referenceSection)}>
          <div {...stylex.props(styles.referenceSectionLabel)}>{"03 / KEEP THE LOGIC"}</div>
          <h2 {...stylex.props(styles.referenceSectionHeading)}>{"Control flow"}</h2>
          <p {...stylex.props(styles.referenceParagraph)}>
            {
              "Use familiar branches and loops to express your logic. Calls to other functions in the same module are supported, including recursion."
            }
          </p>
          <CodeBlock
            filename="fibonacci.lucent.ts"
            code={
              "export function fibonacci(n: number): number {\n  if (n <= 1) return n;\n  return fibonacci(n - 1) + fibonacci(n - 2);\n}"
            }
          />
          <div {...stylex.props(styles.referenceColumns)}>
            <div>
              <h3 {...stylex.props(styles.referenceColumnHeading)}>{"Supported statements"}</h3>
              <ul {...stylex.props(styles.referenceList)}>
                <li {...stylex.props(styles.referenceListItem)}>
                  <code {...stylex.props(styles.referenceInlineCode)}>{"const"}</code>
                  {" and "}
                  <code {...stylex.props(styles.referenceInlineCode)}>{"let"}</code>
                </li>
                <li {...stylex.props(styles.referenceListItem)}>
                  <code {...stylex.props(styles.referenceInlineCode)}>{"if"}</code>
                  {" / "}
                  <code {...stylex.props(styles.referenceInlineCode)}>{"else"}</code>
                </li>
                <li {...stylex.props(styles.referenceListItem)}>
                  <code {...stylex.props(styles.referenceInlineCode)}>{"while"}</code>
                  {" and "}
                  <code {...stylex.props(styles.referenceInlineCode)}>{"for (;;)"}</code>
                </li>
                <li {...stylex.props(styles.referenceListItem)}>
                  <code {...stylex.props(styles.referenceInlineCode)}>{"for … of"}</code>
                  {" over an array"}
                </li>
                <li {...stylex.props(styles.referenceListItem)}>
                  <code {...stylex.props(styles.referenceInlineCode)}>{"return"}</code>
                  {", "}
                  <code {...stylex.props(styles.referenceInlineCode)}>{"break"}</code>
                  {", "}
                  <code {...stylex.props(styles.referenceInlineCode)}>{"continue"}</code>
                  {", "}
                  <code {...stylex.props(styles.referenceInlineCode)}>{"throw"}</code>
                </li>
                <li {...stylex.props(styles.referenceListItem)}>{"Expression statements and blocks"}</li>
              </ul>
            </div>
            <div>
              <h3 {...stylex.props(styles.referenceColumnHeading)}>{"Outside the subset"}</h3>
              <ul {...stylex.props(styles.referenceList)}>
                <li {...stylex.props(styles.referenceListItem)}>
                  <code {...stylex.props(styles.referenceInlineCode)}>{"var"}</code>
                  {" and "}
                  <code {...stylex.props(styles.referenceInlineCode)}>{"switch"}</code>
                </li>
                <li {...stylex.props(styles.referenceListItem)}>
                  <code {...stylex.props(styles.referenceInlineCode)}>{"do … while"}</code>
                  {" and "}
                  <code {...stylex.props(styles.referenceInlineCode)}>{"for … in"}</code>
                </li>
                <li {...stylex.props(styles.referenceListItem)}>
                  <code {...stylex.props(styles.referenceInlineCode)}>{"try"}</code>
                  {" / "}
                  <code {...stylex.props(styles.referenceInlineCode)}>{"catch"}</code>
                </li>
                <li {...stylex.props(styles.referenceListItem)}>
                  {"Labels, "}
                  <code {...stylex.props(styles.referenceInlineCode)}>{"with"}</code>
                  {", and "}
                  <code {...stylex.props(styles.referenceInlineCode)}>{"debugger"}</code>
                </li>
                <li {...stylex.props(styles.referenceListItem)}>{"Nested function declarations"}</li>
                <li {...stylex.props(styles.referenceListItem)}>{"Class declarations"}</li>
              </ul>
            </div>
          </div>
          <p {...stylex.props(styles.referenceCaveat)}>
            {"Assignments, "}
            <code {...stylex.props(styles.referenceInlineCode)}>{"++"}</code>
            {", "}
            <code {...stylex.props(styles.referenceInlineCode)}>{"--"}</code>
            {", and "}
            <code {...stylex.props(styles.referenceInlineCode)}>{"push"}</code>
            {" are statements only. "}
            <code {...stylex.props(styles.referenceInlineCode)}>{"continue"}</code>
            {" inside a C-style "}
            <code {...stylex.props(styles.referenceInlineCode)}>{"for"}</code>
            {" loop is rejected because it would skip the update step."}
          </p>
        </section>
        <section id="expressions" {...stylex.props(styles.referenceSection)}>
          <div {...stylex.props(styles.referenceSectionLabel)}>{"04 / THE BUILDING BLOCKS"}</div>
          <h2 {...stylex.props(styles.referenceSectionHeading)}>{"Expressions"}</h2>
          <div role="region" aria-label="Supported expressions" tabIndex={0} {...stylex.props(styles.referenceTable)}>
            <table {...stylex.props(styles.referenceDataTable)}>
              <thead>
                <tr>
                  <th scope="col" {...stylex.props(styles.tableHeading)}>
                    {"Operation"}
                  </th>
                  <th scope="col" {...stylex.props(styles.tableHeading)}>
                    {"Supported syntax"}
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td {...stylex.props(styles.tableLabelCell)}>{"Arithmetic"}</td>
                  <td {...stylex.props(styles.tableCell)}>
                    <code {...stylex.props(styles.tableCode)}>{"+ - * / %"}</code>
                    {", unary "}
                    <code {...stylex.props(styles.tableCode)}>{"-"}</code>
                  </td>
                </tr>
                <tr>
                  <td {...stylex.props(styles.tableLabelCell)}>{"Comparison"}</td>
                  <td {...stylex.props(styles.tableCell)}>
                    <code {...stylex.props(styles.tableCode)}>{"< <= > >= === !=="}</code>
                  </td>
                </tr>
                <tr>
                  <td {...stylex.props(styles.tableLabelCell)}>{"Boolean logic"}</td>
                  <td {...stylex.props(styles.tableCell)}>
                    <code {...stylex.props(styles.tableCode)}>{"&& || !"}</code>
                  </td>
                </tr>
                <tr>
                  <td {...stylex.props(styles.tableLabelCell)}>{"Updates"}</td>
                  <td {...stylex.props(styles.tableCell)}>
                    <code {...stylex.props(styles.tableCode)}>{"+= -= *= /= ++ --"}</code>
                    {" as statements"}
                  </td>
                </tr>
                <tr>
                  <td {...stylex.props(styles.tableLabelCell)}>{"Struct fields"}</td>
                  <td {...stylex.props(styles.tableCell)}>
                    <code {...stylex.props(styles.tableCode)}>{"value.field"}</code>
                  </td>
                </tr>
                <tr>
                  <td {...stylex.props(styles.tableLabelCell)}>{"Arrays"}</td>
                  <td {...stylex.props(styles.tableCell)}>
                    <code {...stylex.props(styles.tableCode)}>{"array.length"}</code>
                    {", "}
                    <code {...stylex.props(styles.tableCode)}>{"array[i]"}</code>
                    {", "}
                    <code {...stylex.props(styles.tableCode)}>{"array.push(x)"}</code>
                  </td>
                </tr>
                <tr>
                  <td {...stylex.props(styles.tableLabelCell)}>{"Functions"}</td>
                  <td {...stylex.props(styles.tableCell)}>
                    {"Calls within the same module; "}
                    <code {...stylex.props(styles.tableCode)}>{"await"}</code>
                    {" inside async functions"}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <p {...stylex.props(styles.referenceParagraph)}>
            {"Write number, string, boolean, "}
            <code {...stylex.props(styles.referenceInlineCode)}>{"null"}</code>
            {", and "}
            <code {...stylex.props(styles.referenceInlineCode)}>{"undefined"}</code>
            {
              " literals, array literals, and object literals with a known struct target type. Template strings can interpolate primitive values. Parenthesized expressions are supported."
            }
          </p>
          <p {...stylex.props(styles.referenceCaveat)}>
            {"Use strict equality: "}
            <code {...stylex.props(styles.referenceInlineCode)}>{"=="}</code>
            {" and "}
            <code {...stylex.props(styles.referenceInlineCode)}>{"!="}</code>
            {" are rejected. Dynamic struct access such as "}
            <code {...stylex.props(styles.referenceInlineCode)}>{"obj[key]"}</code>
            {" is not supported. Closures, "}
            <code {...stylex.props(styles.referenceInlineCode)}>{"this"}</code>
            {", spread, destructuring, optional chaining, "}
            <code {...stylex.props(styles.referenceInlineCode)}>{"typeof"}</code>
            {", "}
            <code {...stylex.props(styles.referenceInlineCode)}>{"in"}</code>
            {", and "}
            <code {...stylex.props(styles.referenceInlineCode)}>{"instanceof"}</code>
            {" are also outside the subset. The only supported "}
            <code {...stylex.props(styles.referenceInlineCode)}>{"new"}</code>
            {" expression constructs a "}
            <code {...stylex.props(styles.referenceInlineCode)}>{"LucentError"}</code>
            {" for throwing."}
          </p>
        </section>
        <section id="async-errors" {...stylex.props(styles.referenceSection)}>
          <div {...stylex.props(styles.referenceSectionLabel)}>{"05 / ASYNC & FAILURE"}</div>
          <h2 {...stylex.props(styles.referenceSectionHeading)}>{"Async functions & errors"}</h2>
          <p {...stylex.props(styles.referenceParagraph)}>
            {"An async function must declare a "}
            <code {...stylex.props(styles.referenceInlineCode)}>{"Promise<T>"}</code>
            {" return type. This is the only place "}
            <code {...stylex.props(styles.referenceInlineCode)}>{"Promise"}</code>
            {" is allowed. Swift receives an "}
            <code {...stylex.props(styles.referenceInlineCode)}>{"async"}</code>
            {" function; Kotlin receives a "}
            <code {...stylex.props(styles.referenceInlineCode)}>{"suspend"}</code>
            {" function."}
          </p>
          <CodeBlock
            filename="async-sum.lucent.ts"
            code={
              "async function scale(value: number): Promise<number> {\n  return value * 2;\n}\n\nexport async function total(values: number[]): Promise<number> {\n  let sum = 0;\n  for (const value of values) {\n    sum += value;\n  }\n  return await scale(sum);\n}"
            }
          />
          <p {...stylex.props(styles.referenceParagraph)}>
            <code {...stylex.props(styles.referenceInlineCode)}>{"await"}</code>
            {" is only valid inside an async function. Using it elsewhere is rejected by the parser as "}
            <code {...stylex.props(styles.referenceInlineCode)}>{"NT1000"}</code>
            {"; the checker also defines "}
            <code {...stylex.props(styles.referenceInlineCode)}>{"NT1013"}</code>
            {" for this condition."}
          </p>
          <h3 {...stylex.props(styles.referenceSubheading)}>{"Throw a structured error"}</h3>
          <p {...stylex.props(styles.referenceParagraph)}>
            <code {...stylex.props(styles.referenceInlineCode)}>{"LucentError"}</code>
            {
              " is a compiler-known global, so it needs no import. Throw it with a code and an optional message. JavaScript receives an error with "
            }
            <code {...stylex.props(styles.referenceInlineCode)}>{"code"}</code>
            {" and "}
            <code {...stylex.props(styles.referenceInlineCode)}>{"message"}</code>
            {" through either Expo or Nitro."}
          </p>
          <CodeBlock
            filename="throw.lucent.ts"
            code={
              'export function divide(a: number, b: number): number {\n  if (b === 0) {\n    throw new LucentError("DIVIDE_BY_ZERO", { message: "Cannot divide by zero" });\n  }\n  return a / b;\n}\n\nexport function fail(): void {\n  throw new LucentError("ALWAYS");\n}'
            }
          />
          <p {...stylex.props(styles.referenceParagraph)}>
            {"Other thrown values are rejected with "}
            <code {...stylex.props(styles.referenceInlineCode)}>{"NT1001"}</code>
            {". Native "}
            <code {...stylex.props(styles.referenceInlineCode)}>{"try"}</code>
            {" / "}
            <code {...stylex.props(styles.referenceInlineCode)}>{"catch"}</code>
            {" is not part of the subset."}
          </p>
        </section>
        <section id="semantics" {...stylex.props(styles.referenceSection)}>
          <div {...stylex.props(styles.referenceSectionLabel)}>{"06 / ACROSS THE BOUNDARY"}</div>
          <h2 {...stylex.props(styles.referenceSectionHeading)}>{"Runtime semantics"}</h2>
          <dl {...stylex.props(styles.semanticsList)}>
            <div {...stylex.props(styles.semanticsRow)}>
              <dt {...stylex.props(styles.semanticsTerm)}>{"Numbers"}</dt>
              <dd {...stylex.props(styles.referenceNoteText)}>
                <code {...stylex.props(styles.referenceInlineCode)}>{"number"}</code>
                {" is an IEEE 754 double. Division is floating-point; remainder follows JavaScript semantics. String "}
                <code {...stylex.props(styles.referenceInlineCode)}>{"+"}</code>
                {" concatenates."}
              </dd>
            </div>
            <div {...stylex.props(styles.semanticsRow)}>
              <dt {...stylex.props(styles.semanticsTerm)}>{"Sized integers"}</dt>
              <dd {...stylex.props(styles.referenceNoteText)}>
                {"Arithmetic wraps on overflow using the target platform’s sized integer representation."}
              </dd>
            </div>
            <div {...stylex.props(styles.semanticsRow)}>
              <dt {...stylex.props(styles.semanticsTerm)}>{"Arrays"}</dt>
              <dd {...stylex.props(styles.referenceNoteText)}>
                {
                  "Arrays are value-copied when they cross the JavaScript boundary. The language contract specifies reference sharing inside native code."
                }
              </dd>
            </div>
            <div {...stylex.props(styles.semanticsRow)}>
              <dt {...stylex.props(styles.semanticsTerm)}>{"Bytes"}</dt>
              <dd {...stylex.props(styles.referenceNoteText)}>
                <code {...stylex.props(styles.referenceInlineCode)}>{"Uint8Array"}</code>
                {" crosses the boundary as an "}
                <code {...stylex.props(styles.referenceInlineCode)}>{"ArrayBuffer"}</code>
                {". Synchronous functions may read it in place; async functions receive a copy. Indexing yields a "}
                <code {...stylex.props(styles.referenceInlineCode)}>{"number"}</code>
                {"."}
              </dd>
            </div>
            <div {...stylex.props(styles.semanticsRow)}>
              <dt {...stylex.props(styles.semanticsTerm)}>{"Errors"}</dt>
              <dd {...stylex.props(styles.referenceNoteText)}>
                {"A thrown "}
                <code {...stylex.props(styles.referenceInlineCode)}>{"LucentError"}</code>
                {" reaches JavaScript with its code and message on both hosts."}
              </dd>
            </div>
          </dl>
        </section>
        <section id="diagnostics" {...stylex.props(styles.referenceSection)}>
          <div {...stylex.props(styles.referenceSectionLabel)}>{"07 / BEFORE YOU SHIP"}</div>
          <h2 {...stylex.props(styles.referenceSectionHeading)}>{"Clear compiler diagnostics"}</h2>
          <p {...stylex.props(styles.referenceParagraph)}>
            {"Unsupported TypeScript produces a dedicated "}
            <code {...stylex.props(styles.referenceInlineCode)}>{"NT"}</code>
            {" diagnostic. Check a module before generating native code:"}
          </p>
          <CodeBlock filename="Terminal" code={"bun run lucent check fixtures/clamp.lucent.ts"} />
          <div
            role="region"
            aria-label="Lucent compiler diagnostic codes"
            tabIndex={0}
            {...stylex.props(styles.referenceTable)}
          >
            <table {...stylex.props(styles.referenceDataTable)}>
              <thead>
                <tr>
                  <th scope="col" {...stylex.props(styles.tableHeading)}>
                    {"Code"}
                  </th>
                  <th scope="col" {...stylex.props(styles.tableHeading)}>
                    {"Meaning"}
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td {...stylex.props(styles.diagnosticCodeCell)}>{"NT1000"}</td>
                  <td {...stylex.props(styles.tableCell)}>{"Syntax error (from the parser)"}</td>
                </tr>
                <tr>
                  <td {...stylex.props(styles.diagnosticCodeCell)}>{"NT1001"}</td>
                  <td {...stylex.props(styles.tableCell)}>{"Unsupported syntax"}</td>
                </tr>
                <tr>
                  <td {...stylex.props(styles.diagnosticCodeCell)}>{"NT1002"}</td>
                  <td {...stylex.props(styles.tableCell)}>{"Dynamic property access"}</td>
                </tr>
                <tr>
                  <td {...stylex.props(styles.diagnosticCodeCell)}>{"NT1003"}</td>
                  <td {...stylex.props(styles.tableCell)}>{"Unsupported type"}</td>
                </tr>
                <tr>
                  <td {...stylex.props(styles.diagnosticCodeCell)}>{"NT1004"}</td>
                  <td {...stylex.props(styles.tableCell)}>
                    <code {...stylex.props(styles.tableCode)}>{"any"}</code>
                    {" / "}
                    <code {...stylex.props(styles.tableCode)}>{"unknown"}</code>
                    {" is prohibited"}
                  </td>
                </tr>
                <tr>
                  <td {...stylex.props(styles.diagnosticCodeCell)}>{"NT1005"}</td>
                  <td {...stylex.props(styles.tableCell)}>{"Function value cannot cross the native boundary"}</td>
                </tr>
                <tr>
                  <td {...stylex.props(styles.diagnosticCodeCell)}>{"NT1006"}</td>
                  <td {...stylex.props(styles.tableCell)}>{"Unsupported dependency"}</td>
                </tr>
                <tr>
                  <td {...stylex.props(styles.diagnosticCodeCell)}>{"NT1007"}</td>
                  <td {...stylex.props(styles.tableCell)}>{"Too many parameters"}</td>
                </tr>
                <tr>
                  <td {...stylex.props(styles.diagnosticCodeCell)}>{"NT1010"}</td>
                  <td {...stylex.props(styles.tableCell)}>{"Unknown identifier"}</td>
                </tr>
                <tr>
                  <td {...stylex.props(styles.diagnosticCodeCell)}>{"NT1011"}</td>
                  <td {...stylex.props(styles.tableCell)}>{"Type mismatch"}</td>
                </tr>
                <tr>
                  <td {...stylex.props(styles.diagnosticCodeCell)}>{"NT1012"}</td>
                  <td {...stylex.props(styles.tableCell)}>{"Wrong number of arguments"}</td>
                </tr>
                <tr>
                  <td {...stylex.props(styles.diagnosticCodeCell)}>{"NT1013"}</td>
                  <td {...stylex.props(styles.tableCell)}>
                    <code {...stylex.props(styles.tableCode)}>{"await"}</code>
                    {" outside an async function"}
                  </td>
                </tr>
                <tr>
                  <td {...stylex.props(styles.diagnosticCodeCell)}>{"NT1014"}</td>
                  <td {...stylex.props(styles.tableCell)}>{"Missing type annotation"}</td>
                </tr>
                <tr>
                  <td {...stylex.props(styles.diagnosticCodeCell)}>{"NT1015"}</td>
                  <td {...stylex.props(styles.tableCell)}>{"Missing return"}</td>
                </tr>
                <tr>
                  <td {...stylex.props(styles.diagnosticCodeCell)}>{"NT1016"}</td>
                  <td {...stylex.props(styles.tableCell)}>
                    {"Assignment to a "}
                    <code {...stylex.props(styles.tableCode)}>{"const"}</code>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <p {...stylex.props(styles.referenceParagraph)}>
            {
              "For a missing annotation, add explicit parameter and return types. For an unsupported dependency, move the integration outside your Lucent module and pass the required values into its exported functions."
            }
          </p>
        </section>
        <div {...stylex.props(styles.referenceNext)}>
          <div>
            <span {...stylex.props(sharedStyles.eyebrow2)}>{"PUT IT INTO PRACTICE"}</span>
            <h2 {...stylex.props(styles.referenceNextHeading)}>{"Your first native function."}</h2>
          </div>
          <Link to="/" hash="get-started" {...stylex.props(styles.referenceNextButton)}>
            {"Start building "}
            <span aria-hidden="true" {...stylex.props(sharedStyles.buttonArrow)}>
              {"↗"}
            </span>
          </Link>
        </div>
      </main>
    </div>
  );
}
