import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { Invocation } from "../args.ts";
import { type PackageManager, runner } from "../package-manager.ts";
import { pick } from "../templates/pick.ts";
import {
  PROJECT_TEMPLATE_SUMMARIES,
  PROJECT_TEMPLATES,
  type ProjectTemplate,
  writeProject,
} from "../templates/projects.ts";

/** The package manager that runs `npm create`/`pnpm dlx`…, from its user agent; npm otherwise. */
function invokingPackageManager(env: NodeJS.ProcessEnv): PackageManager {
  const agent = env.npm_config_user_agent ?? "";
  for (const pm of ["pnpm", "yarn", "bun"] as const) if (agent.startsWith(`${pm}/`)) return pm;
  return "npm";
}

/**
 * `lucent create <name>`: a new project in ./<name> from a template (--template;
 * picked in a terminal): an Expo app, a bare React Native app or a Lucent
 * library, set up for Lucent, with sample modules. Installs its
 * dependencies unless --skip-install.
 */
export async function run({ root, flags, positionals, out }: Invocation): Promise<number> {
  const t = out.theme;
  const fail = (code: number, message: string) => {
    if (out.json) out.data({ ok: false, error: message });
    else out.error(`${t.error(t.symbols.fail)} ${message}`);
    return code;
  };

  const [name] = positionals;
  if (!name)
    return fail(
      2,
      `name the project: lucent create <name> [--template ${PROJECT_TEMPLATES.join("|")}]`,
    );
  if (!/^(@[\w.-]+\/)?[\w.-]+$/.test(name))
    return fail(2, `${name} is not a project name: use letters, digits, ., - and _`);

  let template: ProjectTemplate | undefined;
  if (typeof flags.template === "string") {
    if (!(PROJECT_TEMPLATES as readonly string[]).includes(flags.template))
      return fail(2, `no project template ${flags.template}: ${PROJECT_TEMPLATES.join(", ")}`);
    template = flags.template as ProjectTemplate;
  } else if (flags.yes || out.json || !out.terminal.interactive) template = "expo";
  else {
    template = await pick(
      "Which project?",
      PROJECT_TEMPLATES.map((v) => ({ value: v, label: v, hint: PROJECT_TEMPLATE_SUMMARIES[v] })),
      t,
    );
    if (!template) return fail(1, "no template was chosen; nothing was written");
  }

  const dir = path.resolve(root, path.basename(name));
  if (fs.existsSync(dir) && fs.readdirSync(dir).length)
    return fail(
      1,
      `${path.relative(process.cwd(), dir) || dir} exists and isn't empty; nothing was written`,
    );

  const files = writeProject(template, dir, name);
  const pm = invokingPackageManager(process.env);
  const apps = template === "library" ? [dir, path.join(dir, "example")] : [dir];

  let installed = false;
  if (!flags["skip-install"]) {
    for (const at of apps) {
      if (!out.json)
        out.print(t.dim(`${pm} install in ${path.relative(process.cwd(), at) || "."}…`));
      const r = spawnSync(pm, ["install"], {
        cwd: at,
        stdio: out.json ? "ignore" : "inherit",
        shell: process.platform === "win32",
      });
      if (r.status !== 0)
        return fail(
          1,
          `${pm} install failed in ${path.relative(process.cwd(), at) || "."}: the project is written; run it again there`,
        );
    }
    installed = true;
  }

  const x = runner(pm);
  const cd = `cd ${path.relative(process.cwd(), dir) || "."}`;
  const install = installed ? [] : [`${pm} install`];
  const next = {
    expo: [cd, ...install, `${x} expo run:ios`],
    view: [cd, ...install, `${x} expo run:ios`],
    bare: [cd, ...install, `${pm} run pods`, `${x} react-native run-ios`],
    library: [cd, ...install, `${x} lucent check`, "cd example", ...install, `${x} expo run:ios`],
    module: [cd, ...install, `${x} lucent build --platforms host`],
  }[template];

  if (out.json) {
    out.data({ ok: true, template, dir, files, installed, next });
    return 0;
  }
  out.print(
    `${t.success(t.symbols.ok)} ${t.bold(path.basename(dir))}  ${t.dim(`${template}: ${PROJECT_TEMPLATE_SUMMARIES[template]}, ${files.length} files`)}`,
  );
  out.print(`\n${t.dim("next")}  ${next.join(" && ")}`);
  return 0;
}
