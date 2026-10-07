import fs from "node:fs";
import path from "node:path";
import type { Invocation } from "../args.ts";

/** `UserCard` → `user-card`: the component's file name. */
const fileName = (component: string) =>
  component.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();

/** The declaration JavaScript imports, and each platform's component of its views, in a Flex. */
function files(name: string, base: string): Record<string, string> {
  const declaration = `// A component JavaScript renders: <${name} title="…" />. Each platform's file makes its views.
import type { UIView } from "lucent:ios/UIKit";
import type { View } from "lucent:android/android.view";

export type Props = { title: string };

export declare function ${name}(props: Props): UIView | View;
`;

  const component = (imports: string[], root: string, label: string) => `${imports.join("\n")}
import type { Props } from "./${base}.lucent";

export function ${name}(props: Props): ${root} {
  return (
    <Flex style={{ flexDirection: "row", padding: 8 }}>
      <${label} text={props.title} />
    </Flex>
  );
}
`;

  return {
    [`src/${base}.lucent.ts`]: declaration,
    [`src/${base}.ios.lucent.tsx`]: component(
      [
        'import { Flex } from "lucent:ui";',
        'import { UILabel, type UIView } from "lucent:ios/UIKit";',
      ],
      "UIView",
      "UILabel",
    ),
    [`src/${base}.android.lucent.tsx`]: component(
      [
        'import { Flex } from "lucent:ui";',
        'import { TextView } from "lucent:android/android.widget";',
        'import type { View } from "lucent:android/android.view";',
      ],
      "View",
      "TextView",
    ),
  };
}

/**
 * `lucent new view <Name>`: a component in src/, its declaration and each
 * platform's native views in a Flex.
 */
export function run({ root, positionals, out }: Invocation): number {
  const t = out.theme;
  const [name] = positionals;

  if (!name || !/^[A-Z][A-Za-z0-9]*$/.test(name)) {
    out.error(
      `${t.error(t.symbols.fail)} ${name ? `${name} is not a component name: start with a capital letter, then letters and digits` : "name the component: lucent new view <Name>"}`,
    );
    return 2;
  }

  const base = fileName(name);
  const written = files(name, base);
  const existing = Object.keys(written).find((f) => fs.existsSync(path.join(root, f)));
  if (existing) {
    out.error(`${t.error(t.symbols.fail)} ${existing} exists; nothing was written`);
    return 1;
  }

  for (const [file, text] of Object.entries(written)) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), text);
    out.print(`${t.success(t.symbols.ok)} ${file}`);
  }

  // Its React types: the declarations lucent build writes, which Metro resolves to the module.
  const use = `import { ${name} } from "lucent:views/${base}";`;
  if (out.json) out.data({ files: Object.keys(written), import: use });
  else out.print(`\n${t.dim("use it")}  ${use}`);
  return 0;
}
