import fs from "node:fs";
import path from "node:path";
import type { Invocation } from "../args.ts";
import {
  MODULE_TEMPLATE_SUMMARIES,
  MODULE_TEMPLATES,
  type ModuleTemplate,
  platformSource,
  starterModule,
} from "../templates/modules.ts";
import { pick } from "../templates/pick.ts";

/**
 * `lucent new module <name>`: a starter module in src/, from a template
 * (--template; picked in a terminal), or with --ios / --android one module
 * that branches on PLATFORM, the other branch throwing.
 */
export async function run({ root, flags, positionals, out }: Invocation): Promise<number> {
  const t = out.theme;
  const [name] = positionals;
  if (!name || !/^[A-Za-z_$][\w$-]*$/.test(name)) {
    out.error(
      `${t.error(t.symbols.fail)} ${name ? `${name} is not a module name: use letters, digits, - and _, starting with a letter` : "name the module: lucent new module <name>"}`,
    );
    return 2;
  }

  const wanted = (["ios", "android"] as const).filter((p) => flags[p]);
  let template: ModuleTemplate | undefined;
  if (typeof flags.template === "string") {
    if (!(MODULE_TEMPLATES as readonly string[]).includes(flags.template)) {
      out.error(
        `${t.error(t.symbols.fail)} no module template ${flags.template}: ${MODULE_TEMPLATES.join(", ")}`,
      );
      return 2;
    }
    template = flags.template as ModuleTemplate;
  } else if (!wanted.length && !flags.shared && !flags.yes && !out.json && out.terminal.interactive)
    template = await pick(
      "Which module?",
      MODULE_TEMPLATES.map((v) => ({ value: v, label: v, hint: MODULE_TEMPLATE_SUMMARIES[v] })),
      t,
    );

  const starter =
    wanted.length && !template
      ? {
          files: { [`src/${name}.lucent.ts`]: platformSource(name, wanted) },
          import: `import { hello } from "./src/${name}.lucent";`,
        }
      : starterModule(template ?? "function", name);

  const files = Object.keys(starter.files);
  const taken = files.filter((f) => fs.existsSync(path.join(root, f)));
  // A module of that name in the other extension is the same module.
  const twin = files
    .map((f) => (f.endsWith(".tsx") ? f.slice(0, -1) : `${f}x`))
    .filter((f) => fs.existsSync(path.join(root, f)));
  if (taken.length || twin.length) {
    out.error(
      `${t.error(t.symbols.fail)} ${[...taken, ...twin].join(", ")} exists; nothing was written`,
    );
    return 1;
  }
  for (const [file, text] of Object.entries(starter.files)) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), text);
  }

  if (out.json) {
    out.data({ files, import: starter.import });
    return 0;
  }
  for (const f of files) out.print(`${t.success(t.symbols.ok)} ${f}`);
  const missing = wanted.length === 1 ? (wanted[0] === "ios" ? "Android" : "iOS") : undefined;
  if (missing) out.print(t.dim(`\nThe ${missing} branch throws until you implement it.`));
  if (template === "view")
    out.print(t.dim("\nA component builds for a platform whose SDK is installed: lucent build."));
  out.print(`\n${t.dim("use it")}  ${starter.import}`);
  return 0;
}
