/**
 * Reads a JSON Schema into the rows of a reference table: every field,
 * nested ones by path (`a.b`, `list[].c`, `map.<name>.d`), with its type,
 * whether it's required and its description.
 */

export interface SchemaNode {
  $ref?: string;
  type?: string | string[];
  title?: string;
  description?: string;
  enum?: unknown[];
  const?: unknown;
  required?: string[];
  properties?: Record<string, SchemaNode>;
  additionalProperties?: SchemaNode | boolean;
  items?: SchemaNode;
  anyOf?: SchemaNode[];
  oneOf?: SchemaNode[];
  definitions?: Record<string, SchemaNode>;
  $defs?: Record<string, SchemaNode>;
}

export interface SchemaField {
  field: string;
  type: string;
  required: boolean;
  description: string;
}

const unique = (xs: string[]): string[] => [...new Set(xs)];

export function schemaFields(root: SchemaNode): SchemaField[] {
  const resolve = (node: SchemaNode): SchemaNode => {
    const ref = /^#\/(definitions|\$defs)\/(.+)$/.exec(node.$ref ?? "");
    if (!node.$ref) return node;
    const target = ref && root[ref[1] as "definitions" | "$defs"]?.[ref[2]!];
    if (!target) throw new Error(`schema: can't resolve ${node.$ref}`);
    return target;
  };

  const typeOf = (n: SchemaNode): string => {
    const node = resolve(n);
    const union = node.anyOf ?? node.oneOf;
    if (union) return unique(union.map(typeOf)).join(" or ");
    if (node.enum) return node.enum.map((v) => JSON.stringify(v)).join(" or ");
    if (node.const !== undefined) return JSON.stringify(node.const);
    if (Array.isArray(node.type)) return node.type.join(" or ");
    if (node.type === "array") {
      const item = node.items ? typeOf(node.items) : "unknown";
      return item.includes(" or ") ? `(${item})[]` : `${item}[]`;
    }
    if (node.type === "object" && typeof node.additionalProperties === "object" && !node.properties)
      return `{ [name]: ${typeOf(node.additionalProperties)} }`;
    return node.type ?? "unknown";
  };

  const rows = new Map<string, { types: string[]; required: boolean; description: string }>();
  const add = (field: string, type: string, required: boolean, description: string) => {
    const row = rows.get(field);
    if (!row) rows.set(field, { types: [type], required, description });
    else {
      row.types.push(type);
      row.description ||= description;
    }
  };

  const visit = (n: SchemaNode, at: string, seen: Set<string>): void => {
    if (n.$ref) {
      if (seen.has(n.$ref)) return;
      seen = new Set([...seen, n.$ref]);
    }
    const node = resolve(n);
    // A union's members describe one value: their fields share its path.
    for (const member of node.anyOf ?? node.oneOf ?? []) visit(member, at, seen);
    for (const [name, child] of Object.entries(node.properties ?? {})) {
      const field = at ? `${at}.${name}` : name;
      add(
        field,
        typeOf(child),
        node.required?.includes(name) ?? false,
        resolve(child).description ?? "",
      );
      visit(child, field, seen);
    }
    if (node.items) visit(node.items, `${at}[]`, seen);
    if (typeof node.additionalProperties === "object")
      visit(node.additionalProperties, `${at}.<name>`, seen);
  };
  visit(root, "", new Set());

  return [...rows].map(([field, { types, required, description }]) => ({
    field,
    type: unique(types.flatMap((t) => t.split(" or "))).join(" or "),
    required,
    description,
  }));
}

/** A command's `--json` output, as its schema describes it. */
export interface JsonOutput {
  command: string;
  /** The schema's file, served at https://lucent-lang.dev/schemas/<file>. */
  file: string;
  description: string;
  /** The shapes it takes: one per member of a top-level oneOf, else one. */
  variants: { description: string; fields: SchemaField[] }[];
}

/**
 * The schemas titled `lucent <command> --json` (several, comma-separated, for
 * one output two commands share), one entry per public command a title names.
 */
export function jsonOutputs(
  schemas: { file: string; schema: SchemaNode }[],
  commands: { name: string; internal?: boolean }[],
): JsonOutput[] {
  return schemas.flatMap(({ file, schema }) => {
    const named = (schema.title ?? "")
      .split(", ")
      .map((part) => /^lucent (.+) --json$/.exec(part)?.[1])
      .filter((name) => name !== undefined);

    return named.flatMap((name) => {
      const command = commands.find((c) => c.name === name);
      if (!command) throw new Error(`${file}: there is no \`lucent ${name}\` command`);
      return [
        {
          command: name,
          file,
          description: schema.description ?? "",
          variants: schema.oneOf
            ? schema.oneOf.map((variant) => ({
                description: variant.description ?? "",
                // Its own root, with the definitions its references name.
                fields: schemaFields({
                  definitions: schema.definitions,
                  $defs: schema.$defs,
                  ...variant,
                }),
              }))
            : [{ description: "", fields: schemaFields(schema) }],
        },
      ];
    });
  });
}
