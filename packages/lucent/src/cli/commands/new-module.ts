import fs from "node:fs";
import path from "node:path";
import type { Invocation } from "../args.ts";

const platforms = ["ios", "android"] as const;
type Platform = (typeof platforms)[number];

/** Each platform's branch of the scaffold: what it imports and what `hello` does there. */
const branches: Record<Platform, { label: string; imports: string[]; body: string[] }> = {
  ios: {
    label: "iOS",
    imports: ['import { UIDevice } from "lucent:ios/UIKit";', 'import { main } from "lucent:thread";'],
    body: ["const system = await main(() => UIDevice.current.systemName);", "return `Hello, ${name}, from ${system}`;"],
  },
  android: {
    label: "Android",
    imports: ['import { Build_VERSION } from "lucent:android/android.os";'],
    body: ['return `Hello, ${name}, from Android ${Build_VERSION.RELEASE ?? ""}`;'],
  },
};

const unimplemented = (p: Platform) => [`throw error("ERR_UNIMPLEMENTED", "hello is not implemented on ${branches[p].label} yet");`];

/** One module for both platforms, branching on PLATFORM; a platform not asked for throws. */
function platformModule(name: string, wanted: Platform[]): string {
  const missing = platforms.filter((p) => !wanted.includes(p));
  const imports = [
    'import { PLATFORM } from "lucent:platform";',
    ...wanted.flatMap((p) => branches[p].imports),
    ...(missing.length ? ['import { error } from "lucent:core";'] : []),
  ];
  const body = (p: Platform) => (wanted.includes(p) ? branches[p].body : unimplemented(p)).map((l) => `    ${l}`).join("\n");
  return `// Runs natively on each platform; JavaScript imports it from "./src/${name}.lucent".
${imports.join("\n")}

export async function hello(name: string): Promise<string> {
  if (PLATFORM === "ios") {
${body("ios")}
  } else {
${body("android")}
  }
}
`;
}

const sharedModule = (name: string) => `// Runs as C++; JavaScript imports it from "./src/${name}.lucent".
export function hello(name: string): string {
  return \`Hello, \${name}, from native code\`;
}
`;

/** `lucent new module <name>`: a module in src/, shared or with a branch per platform. */
export function run({ root, flags, positionals, out }: Invocation): number {
  const t = out.theme;
  const [name] = positionals;
  if (!name || !/^[A-Za-z_$][\w$]*$/.test(name)) {
    out.error(`${t.error(t.symbols.fail)} ${name ? `${name} is not a module name: use letters, digits and _, like a JavaScript name` : "name the module: lucent new module <name>"}`);
    return 2;
  }
  const wanted = platforms.filter((p) => flags[p]);
  const file = `src/${name}.lucent.ts`;
  const target = path.join(root, file);
  if (fs.existsSync(target)) {
    out.error(`${t.error(t.symbols.fail)} ${file} exists; nothing was written`);
    return 1;
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, wanted.length ? platformModule(name, wanted) : sharedModule(name));
  out.print(`${t.success(t.symbols.ok)} ${file}`);
  const missing = wanted.length ? platforms.find((p) => !wanted.includes(p)) : undefined;
  if (missing) out.print(t.dim(`\nThe ${branches[missing].label} branch throws until you implement it.`));
  out.print(`\n${t.dim("use it")}  import { hello } from "./src/${name}.lucent";`);
  return 0;
}
