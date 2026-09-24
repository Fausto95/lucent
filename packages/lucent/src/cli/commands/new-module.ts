import fs from "node:fs";
import path from "node:path";
import type { Invocation } from "../args.ts";

/** `lucent new module <name>`: a module in src/, shared or split per platform. */
export function run({ root, flags, positionals, out }: Invocation): number {
  const t = out.theme;
  const [name] = positionals;
  if (!name || !/^[A-Za-z_$][\w$]*$/.test(name)) {
    out.error(`${t.error(t.symbols.fail)} ${name ? `${name} is not a module name: use letters, digits and _, like a JavaScript name` : "name the module: lucent new module <name>"}`);
    return 2;
  }
  const split = !!flags.ios || !!flags.android;
  const files: Record<string, string> = split
    ? {
        [`${name}.lucent.ts`]: `// What JavaScript calls, on every platform: each platform file implements it.\nexport declare function hello(name: string): Promise<string>;\n`,
        ...(flags.ios ? { [`${name}.ios.lucent.ts`]: `import { UIDevice } from "lucent:ios/UIKit";\nimport { main } from "lucent:thread";\n\nexport async function hello(name: string): Promise<string> {\n  const system = await main(() => UIDevice.current.systemName);\n  return \`Hello, \${name}, from \${system}\`;\n}\n` } : {}),
        ...(flags.android ? { [`${name}.android.lucent.ts`]: `import { Build_VERSION } from "lucent:android/android.os";\n\nexport async function hello(name: string): Promise<string> {\n  return \`Hello, \${name}, from Android \${Build_VERSION.RELEASE ?? ""}\`;\n}\n` } : {}),
      }
    : { [`${name}.lucent.ts`]: `// Runs as C++; JavaScript imports it from "./src/${name}.lucent".\nexport function hello(name: string): string {\n  return \`Hello, \${name}, from native code\`;\n}\n` };
  const dir = path.join(root, "src");
  const existing = Object.keys(files).filter((f) => fs.existsSync(path.join(dir, f)));
  if (existing.length) {
    out.error(`${t.error(t.symbols.fail)} ${existing.map((f) => `src/${f}`).join(", ")} exists; nothing was written`);
    return 1;
  }
  fs.mkdirSync(dir, { recursive: true });
  for (const [file, text] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, file), text);
    out.print(`${t.success(t.symbols.ok)} src/${file}`);
  }
  if (split && !(flags.ios && flags.android)) out.print(t.dim(`\nAdd the other platform's file (src/${name}.${flags.ios ? "android" : "ios"}.lucent.ts) before building for it.`));
  out.print(`\n${t.dim("use it")}  import { hello } from "./src/${name}.lucent";`);
  return 0;
}
