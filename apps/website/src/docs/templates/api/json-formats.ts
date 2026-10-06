import type { Block, DocFrontmatter } from "../../types";
import { jsonOutputs, sdkLock } from "../../../generated/json-formats";

export const frontmatter: DocFrontmatter = {
  title: "JSON output and the SDK lock",
  description:
    "The fields of each command's `--json` output, and of `lucent-sdk.lock.json`, from their JSON schemas.",
  kind: "reference",
  sidebar_label: "JSON formats",
};

type Field = { field: string; type: string; required: boolean; description: string };

const table = (fields: Field[]): Block => ({
  kind: "table",
  head: ["Field", "Type", "Always there", "Meaning"],
  rows: fields.map(({ field, type, required, description }) => [
    `\`${field}\``,
    `\`${type}\``,
    required ? "yes" : "",
    description,
  ]),
});

export const blocks: Block[] = [
  {
    kind: "p",
    text: "A command with JSON output, run with `--json`, writes one JSON document on stdout, and its exit code says whether it succeeded. The document is an object, or an array for `lucent sdk coverage`. Problems still go to stderr, so stdout holds only the document.",
  },
  {
    kind: "p",
    text: "Each document follows a JSON Schema served at `https://lucent-lang.dev/schemas/`, which these tables are generated from. `lucent bench` has no schema: its fields are [below](#lucent-bench---json).",
  },
  {
    kind: "p",
    text: "`lucent init`, `lucent dev` and `lucent trace` have no JSON output. With `--json`, they print `lucent <command> has no JSON output: run it without --json` on stderr and exit with code 2.",
  },
  ...jsonOutputs.flatMap(({ command, file, description, variants }): Block[] => [
    { kind: "h2", text: `lucent ${command} --json` },
    ...(description ? [{ kind: "p" as const, text: description }] : []),
    { kind: "p", text: `Schema: \`https://lucent-lang.dev/schemas/${file}\`.` },
    ...(variants.length === 1
      ? [table(variants[0]!.fields)]
      : variants.flatMap((v): Block[] => [{ kind: "h3", text: v.description }, table(v.fields)])),
  ]),
  { kind: "h2", text: "lucent bench --json" },
  {
    kind: "p",
    text: "It prints `{ ok, cases }` once the cases ran, and `{ ok: false, error }` when there's no bench file or Hermes build, or the run failed. A module that doesn't compile prints only its diagnostics, on stderr. It has no schema.",
  },
  table([
    {
      field: "ok",
      type: "boolean",
      required: true,
      description: "Every case ran and gave the same result natively and as JavaScript",
    },
    { field: "error", type: "string", required: false, description: "Why the cases couldn't run" },
    { field: "cases", type: "object[]", required: false, description: "Each case, once they ran" },
    { field: "cases[].file", type: "string", required: true, description: "The bench file" },
    { field: "cases[].name", type: "string", required: true, description: "The case's name" },
    {
      field: "cases[].js",
      type: "number",
      required: true,
      description: "Its time as JavaScript, in milliseconds",
    },
    {
      field: "cases[].native",
      type: "number",
      required: true,
      description: "Its time compiled to C++, in milliseconds",
    },
    {
      field: "cases[].speedup",
      type: "number",
      required: true,
      description: "`js / native`, or 0 when it failed",
    },
    {
      field: "cases[].same",
      type: "boolean",
      required: true,
      description: "Both runs returned the same result",
    },
    {
      field: "cases[].error",
      type: "string",
      required: false,
      description: "The error the case threw",
    },
  ]),
  { kind: "h2", text: "lucent-sdk.lock.json" },
  ...(sdkLock.description ? [{ kind: "p" as const, text: sdkLock.description }] : []),
  {
    kind: "p",
    text: "`lucent sdk lock` writes it at the project's root, and `.lucent/sdk-usage.json` has the same shape. Schema: `https://lucent-lang.dev/schemas/sdk-lock.schema.json`.",
  },
  table(sdkLock.fields),
];
