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
    text: "A command run with `--json` prints one JSON object on stdout, and its exit code says whether it succeeded. Each object follows a JSON Schema served at `https://lucent-lang.dev/schemas/`, which these tables are generated from.",
  },
  ...jsonOutputs.flatMap(({ command, file, description, variants }): Block[] => [
    { kind: "h2", text: `lucent ${command} --json` },
    ...(description ? [{ kind: "p" as const, text: description }] : []),
    { kind: "p", text: `Schema: \`https://lucent-lang.dev/schemas/${file}\`.` },
    ...(variants.length === 1
      ? [table(variants[0]!.fields)]
      : variants.flatMap((v): Block[] => [{ kind: "h3", text: v.description }, table(v.fields)])),
  ]),
  { kind: "h2", text: "lucent-sdk.lock.json" },
  ...(sdkLock.description ? [{ kind: "p" as const, text: sdkLock.description }] : []),
  {
    kind: "p",
    text: "`lucent sdk lock` writes it at the project's root, and `.lucent/sdk-usage.json` has the same shape. Schema: `https://lucent-lang.dev/schemas/sdk-lock.schema.json`.",
  },
  table(sdkLock.fields),
];
