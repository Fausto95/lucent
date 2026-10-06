import fs from "node:fs";
import { lucentPackageOf, lucentPackages } from "./packages.ts";
import path from "node:path";
import { directoryExists, fileExists, readText } from "./reads.ts";
import { fileURLToPath } from "node:url";
import { ts as dts } from "@lucent-lang/codegen";
import ts from "typescript";
import { Codes, type Diagnostic, type QuickFix } from "./diagnostics.ts";
import { sdkDts, stubDts } from "./sdk/dts.ts";
import { cachedDeclarations } from "./sdk/declaration-cache.ts";
import {
  currentSdkIdentity,
  findSdkModule,
  parseSdkType,
  type Platform,
  PLATFORMS,
  platformSdkTyped,
  sdkLookup,
  sdkCacheDir,
  sdkNamesOf,
  type SdkModuleSchema,
  sourceModuleLookup,
  WRAP_UNBOUND,
} from "./sdk/schema.ts";
import { NATIVE_JSX_UI, nativeJsxDecls, nativeTags, rootViews } from "./sdk/native-jsx-dts.ts";
import { classOfDecl } from "./sdk/declarations.ts";
import { toolkitDts } from "./sdk/toolkit-dts.ts";
import { viewTag } from "./sdk/view-rules.ts";
import { nativeTagType } from "./ui/roots.ts";
import { extensionDts } from "./extensions/dts.ts";
import { boundExtensions, findExtension } from "./extensions/registry.ts";
import { moduleNamespace } from "./types.ts";
import { sdkLibFile } from "./lib-files.ts";
import { composeModuleText } from "./ui/compose-dts.ts";
import { fabricRequested } from "./ui/switch.ts";
import {
  JSX_SOURCE,
  TOOLKITS,
  type ToolkitName,
  toolkitOfModule,
  toolkitOfPlatform,
  toolkitSource,
} from "./ui/toolkits.ts";

export interface LucentModule {
  /** Module name used from JavaScript: the file name without `.lucent.ts`. */
  name: string;
  file: string;
  sourceFile: ts.SourceFile;
  /** C++ namespace inside `lucent_app`. */
  ns: string;
  /** For a platform file: the shared file declaring the module's exports. */
  declaration?: ts.SourceFile;
  /** A shared declaration compiled on its own (host target): exports throw. */
  stub?: boolean;
}

export interface LucentProgram {
  program: ts.Program;
  platform?: Platform;
  checker: ts.TypeChecker;
  modules: LucentModule[];
  diagnostics: Diagnostic[];
}

const here = path.dirname(fileURLToPath(import.meta.url));

/** Globals Lucent code may use besides the ES2022 library (console, …). */
export function globalsPath(): string {
  return path.resolve(here, "../lib/globals.d.ts");
}

/** Whether a declaration comes from the TypeScript library or Lucent's globals. */
export function isLibFile(sf: ts.SourceFile): boolean {
  return (
    sf.isDeclarationFile &&
    (/[\\/]typescript[\\/]lib[\\/]lib\./.test(sf.fileName) ||
      path.resolve(sf.fileName) === globalsPath())
  );
}

/** The JavaScript implementations of lucent:core, for running Lucent modules as plain JavaScript (e2e, lucent bench). */
export function coreJsPath(): string {
  return path.resolve(here, "../lib/core.cjs");
}

/** Path of the `lucent:core` type declarations. */
export function coreTypesPath(): string {
  return sdkLibPath("core");
}

export const LUCENT_EXTENSION = /\.lucent\.tsx?$/;
export const PLATFORM_EXTENSION = /\.(ios|android)\.lucent\.tsx?$/;

/** The module a file belongs to: `haptics` for haptics.lucent.ts and haptics.ios.lucent.ts. */
/**
 * A module's name: its file's, or, in a Lucent package, `<package>/<path>`
 * (its path under the package's sources, without the extension).
 */
export function moduleNameOf(file: string): string {
  const base = (f: string) => f.replace(PLATFORM_EXTENSION, "").replace(LUCENT_EXTENSION, "");
  const pkg = lucentPackageOf(file);
  if (!pkg) return base(path.basename(file));
  return `${pkg.name}/${base(path.relative(pkg.sources, path.resolve(file)))
    .split(path.sep)
    .join("/")}`;
}

/** The app's Lucent files and those of the Lucent packages it depends on. */
export function projectFiles(root: string): string[] {
  return [
    ...findLucentFiles(root),
    ...lucentPackages(root).flatMap((p) => findLucentFiles(p.sources)),
  ].sort();
}

/** The platform of a `*.ios.lucent.ts` / `*.android.lucent.ts` file. */
export function platformOf(file: string): Platform | undefined {
  return PLATFORM_EXTENSION.exec(file)?.[1] as Platform | undefined;
}

// SDK declarations are generated from binding schemas and served from this
// virtual directory: lucent:ios/UIKit is <SDK_ROOT>/ios/UIKit.d.ts.
const SDK_ROOT = path.resolve("/__lucent_sdk__");

/**
 * Modules of platforms whose SDK is not installed (or whose imports are
 * deferred), untyped: a shared module's branch for such a platform
 * type-checks, and is never emitted where it is missing (a target's own
 * missing SDK is reported by importDiagnostics). Where views are
 * generated, the platform's toolkit (lucent:swiftui) is untyped too.
 */
const UNTYPED = path.join(SDK_ROOT, "untyped.d.ts");

function untypedSdkText(): string {
  const untyped = PLATFORMS.filter((p) => !platformSdkTyped(p));
  const toolkits = fabricRequested() ? untyped.flatMap((p) => toolkitOfPlatform(p) ?? []) : [];

  return dts.printUnit({
    decls: [...untyped.map((p) => `lucent:${p}/*`), ...toolkits.map((t) => `lucent:${t}`)].map(
      (name) => ({ k: "moduleWildcard", name }),
    ),
  });
}

function sdkLibPath(name: string): string {
  return sdkLibFile(`${name}.d.ts`);
}

/**
 * A toolkit's declarations: generated from its source module (SwiftUI's,
 * served from the virtual directory), or written by hand (lib/sdk).
 */
/** A shared file's JSX runtime (jsxRuntimeText), served from the virtual directory. */
const JSX_RUNTIME = path.join(SDK_ROOT, "toolkit", "jsx.d.ts");

function toolkitTypesPath(name: ToolkitName): string {
  return toolkitSource(name) ? path.join(SDK_ROOT, "toolkit", `${name}.d.ts`) : sdkLibPath(name);
}

/** Each source module's toolkit declarations, written once per schema. */
const toolkitTexts = new WeakMap<SdkModuleSchema, string>();

/**
 * Each SDK module's declarations, written once per schema (they depend on
 * nothing else), and each names-only module's, once per names index: every
 * compile asks for them, and writing UIKit's or Foundation's takes seconds.
 */
const sdkTexts = {
  plain: new WeakMap<SdkModuleSchema, string>(),
  jsx: new WeakMap<SdkModuleSchema, string>(),
};
const stubTexts = new WeakMap<object, string>();

/** A generated toolkit's declarations, or why there are none. */
function toolkitDeclarations(name: ToolkitName): { text: string } | { missing: string } {
  const toolkit = TOOLKITS[name];
  const source = toolkitSource(name);
  if (!source) return { missing: `lucent:${name} is written by hand` };

  const found = sourceModuleLookup(toolkit.platform, source.module);
  if ("missing" in found) return found;

  let text = toolkitTexts.get(found.schema);
  if (text === undefined) {
    text = toolkitDts({ ...toolkit, source }, found.schema);
    toolkitTexts.set(found.schema, text);
  }

  return { text };
}

/**
 * Modules the program's files import get full declarations. On iOS, modules
 * only other modules' signatures mention get their types' names: extracting
 * their schemas (and their dependencies' names) would cost minutes cold.
 */
function virtualSdkText(file: string, direct: Set<string>): string | undefined {
  if (path.resolve(file) === UNTYPED) return untypedSdkText();
  if (path.resolve(file) === JSX_RUNTIME && fabricRequested()) return jsxRuntimeText();
  // lucent:compose: its own declarations, then Compose's, made from its bindings.
  if (path.resolve(file) === sdkLibPath("compose") && fabricRequested())
    return composeModuleText(fs.readFileSync(file, "utf8"));
  const rel = path.relative(SDK_ROOT, path.resolve(file));

  const toolkit = /^toolkit[\\/](\w+)\.d\.ts$/.exec(rel)?.[1];
  if (toolkit && Object.hasOwn(TOOLKITS, toolkit)) {
    const found = toolkitDeclarations(toolkit as ToolkitName);
    return "text" in found ? found.text : undefined;
  }

  const ext = /^ext[\\/]([\w-]+)\.d\.ts$/.exec(rel);
  if (ext) {
    const found = findExtension(ext[1]!);
    return found ? extensionDts(found) : undefined;
  }

  const m = /^(ios|android)[\\/]([\w.]+)\.d\.ts$/.exec(rel);
  if (!m) return undefined;
  const platform = m[1] as Platform;
  const module = m[2]!;
  if (platform === "ios" && !direct.has(`${platform}/${module}`)) {
    const names = sdkNamesOf(platform, module);
    if (!names) return undefined;

    let stub = stubTexts.get(names);
    if (stub === undefined)
      stubTexts.set(
        names,
        (stub = cachedDeclarations(
          sdkCacheDir(),
          currentSdkIdentity(),
          ["names", platform, module],
          () => stubDts(platform, module, names),
        )),
      );

    return stub;
  }
  const schema = findSdkModule(platform, module);
  if (!schema) return undefined;
  // Views' declarations also give each view class its JSX attributes (T48).
  const jsx = fabricRequested();
  const texts = sdkTexts[jsx ? "jsx" : "plain"];
  let text = texts.get(schema);
  if (text === undefined)
    texts.set(
      schema,
      (text = cachedDeclarations(
        sdkCacheDir(),
        currentSdkIdentity(),
        ["full", platform, module, ...(jsx ? ["jsx"] : [])],
        () => sdkDts(schema, { jsx }),
      )),
    );
  // Modules it re-exports are used as directly as it is.
  for (const r of text.matchAll(/^export \* from "lucent:(ios\/_\w+)";$/gm)) direct.add(r[1]!);
  return text;
}

/** `lucent:<platform>/<module>` imports written in these files. */
function directSdkImports(files: string[], readSource: ReadSource | undefined): Set<string> {
  const out = new Set<string>();
  for (const f of files) {
    const text =
      readSource?.(path.resolve(f)) ?? (fs.existsSync(f) ? fs.readFileSync(f, "utf8") : "");
    for (const m of text.matchAll(/["']lucent:(ios|android)\/([\w.]+)["']/g))
      out.add(`${m[1]}/${m[2]}`);
  }
  return out;
}

/** Whether a file imports lucent:platform or a platform's SDK: a shared module that branches on the platform. */
export function usesPlatforms(file: string, readSource?: ReadSource): boolean {
  const text =
    readSource?.(path.resolve(file)) ?? (fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "");
  return /["']lucent:(platform|ios|android)(\/[\w.]+)?["']/.test(text);
}

/** Whether a declaration comes from an SDK binding module. */
export function sdkModuleOf(sf: ts.SourceFile): { platform: Platform; module: string } | undefined {
  const m = /^(ios|android)[\\/]([\w.]+)\.d\.ts$/.exec(
    path.relative(SDK_ROOT, path.resolve(sf.fileName)),
  );
  return m ? { platform: m[1] as Platform, module: m[2]! } : undefined;
}

/** The native extension (`lucent:ext/<name>`) a declaration comes from. */
export function extensionModuleOf(sf: ts.SourceFile): string | undefined {
  return /^ext[\\/]([\w-]+)\.d\.ts$/.exec(path.relative(SDK_ROOT, path.resolve(sf.fileName)))?.[1];
}

const PLATFORM_NAMES: Record<Platform, string> = { ios: "iOS", android: "Android" };

/** The built-in lucent:thread / lucent:ui / lucent:<toolkit> / lucent:ios / lucent:android module a declaration comes from. */
export function builtinSdkModuleOf(sf: ts.SourceFile): string | undefined {
  const file = path.resolve(sf.fileName);
  for (const name of ["thread", "platform", "ui", ...PLATFORMS])
    if (file === sdkLibPath(name)) return `lucent:${name}`;
  for (const name of Object.keys(TOOLKITS) as ToolkitName[])
    if (file === toolkitTypesPath(name)) return `lucent:${name}`;
  if (file === JSX_RUNTIME) return JSX_SOURCE;
  return undefined;
}

export function compilerOptions(): ts.CompilerOptions {
  return {
    strict: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    // esnext.disposable: Symbol.dispose, for `using` declarations.
    lib: ["lib.es2022.d.ts", "lib.esnext.disposable.d.ts"],
    // TypeScript's own: no @typescript/lib-* replacement looked for from the working directory.
    libReplacement: false,
    types: [],
    noEmit: true,
    skipLibCheck: true,
    allowImportingTsExtensions: true,
    noFallthroughCasesInSwitch: false,
    exactOptionalPropertyTypes: false,
    // Reading a missing index yields undefined at runtime; the types must say so.
    noUncheckedIndexedAccess: true,
    // A body's JSX is its platform's toolkit's (compilerHost resolves the runtime per file).
    ...(fabricRequested() ? { jsx: ts.JsxEmit.ReactJSX, jsxImportSource: JSX_SOURCE } : {}),
    // Every platform's modules resolve in every program: a shared module
    // branches on `PLATFORM`, and each target type-checks both branches.
    paths: {
      "lucent:core": [coreTypesPath()],
      "lucent:thread": [sdkLibPath("thread")],
      "lucent:platform": [sdkLibPath("platform")],
      // Internal until views are proven: only when compiles generate them.
      ...(fabricRequested()
        ? Object.fromEntries([
            ["lucent:ui", [sdkLibPath("ui")]],
            [JSX_SOURCE, [JSX_RUNTIME]],
            ...(Object.keys(TOOLKITS) as ToolkitName[]).map((name) => [
              `lucent:${name}`,
              [toolkitTypesPath(name)],
            ]),
          ])
        : {}),
      ...Object.fromEntries(
        PLATFORMS.flatMap((p) => [
          [`lucent:${p}`, [sdkLibPath(p)]],
          [`lucent:${p}/*`, [path.join(SDK_ROOT, p, "*.d.ts")]],
        ]),
      ),
      "lucent:ext/*": [path.join(SDK_ROOT, "ext", "*.d.ts")],
    },
  };
}

/** Finds `*.lucent.ts` files under `root`, skipping node_modules and build output. */
export function findLucentFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (
        entry.name === "node_modules" ||
        entry.name.startsWith(".") ||
        entry.name === "ios" ||
        entry.name === "android"
      )
        continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (LUCENT_EXTENSION.test(entry.name)) out.push(full);
    }
  };
  walk(root);
  return out.sort();
}

/** Text of a file that differs from disk (an editor's unsaved buffer), if any. */
export type ReadSource = (file: string) => string | undefined;

// Library and dependency declarations parse once per process: editors check
// on every edit, and re-parsing lib.es2022 dominates otherwise.
const declarationCache = new Map<string, { text: string; sf: ts.SourceFile }>();

function compilerHost(
  options: ts.CompilerOptions,
  readSource: ReadSource | undefined,
  direct: Set<string>,
): ts.CompilerHost {
  const host = ts.createCompilerHost(options, true);
  const sdkTexts = new Map<string, string | undefined>();
  const virtualSdk = (f: string) => {
    if (!sdkTexts.has(f)) sdkTexts.set(f, virtualSdkText(f, direct));
    return sdkTexts.get(f);
  };
  // Disk reads are noted (reads.ts): a passing check holds while each file is as it found it.
  host.readFile = (f) => virtualSdk(f) ?? readSource?.(path.resolve(f)) ?? readText(f);
  host.fileExists = (f) =>
    readSource?.(path.resolve(f)) !== undefined || virtualSdk(f) !== undefined || fileExists(f);
  // Module resolution skips files in directories that do not exist.
  host.directoryExists = (d) => {
    const rel = path.relative(SDK_ROOT, path.resolve(d));
    return (
      rel === "" ||
      rel === "ext" ||
      rel === "toolkit" ||
      (PLATFORMS as readonly string[]).includes(rel) ||
      directoryExists(d)
    );
  };
  // `lucent:jsx/jsx-runtime`, the JSX runtime every file imports implicitly, is the
  // toolkit of the importing file's platform: its module declares the JSX namespace.
  const cache = ts.createModuleResolutionCache(
    host.getCurrentDirectory(),
    host.getCanonicalFileName,
    options,
  );
  host.resolveModuleNameLiterals = (literals, containing, redirected, opts, sf) =>
    literals.map((literal) => {
      const runtime = jsxRuntimeOf(literal.text, containing);
      return ts.resolveModuleName(
        runtime ?? literal.text,
        containing,
        opts,
        host,
        cache,
        redirected,
        ts.getModeForUsageLocation(sf, literal, opts),
      );
    });
  const getSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (f, language, onError, shouldCreate) => {
    if (!f.endsWith(".d.ts")) return getSourceFile(f, language, onError, shouldCreate);
    const text = host.readFile(f);
    if (text === undefined) return getSourceFile(f, language, onError, shouldCreate);
    const cached = declarationCache.get(f);
    if (cached?.text === text) return cached.sf;
    const sf = ts.createSourceFile(f, text, language, true);
    declarationCache.set(f, { text, sf });
    return sf;
  };
  return host;
}

/**
 * What `specifier` imported from `file` resolves as: for Lucent's JSX
 * runtime, the toolkit module of the file's platform, or null where no
 * toolkit's JSX may be written (a shared file); undefined for any other
 * import, which resolves as it is.
 */
export function jsxRuntimeOf(specifier: string, file: string): string | undefined {
  if (!new RegExp(`^${JSX_SOURCE}/jsx-(dev-)?runtime$`).test(specifier)) return undefined;

  const toolkit = toolkitOfPlatform(platformOf(file));

  return toolkit ? `lucent:${toolkit}` : JSX_SOURCE;
}

/**
 * `lucent:jsx`, a shared file's JSX runtime: its element is every typed
 * toolkit's at once (`View & Composed`), so an element is content of
 * either toolkit's elements and takes either's methods, and a tag is
 * either toolkit's component (`JSX.ElementType`): each element is typed
 * by its own toolkit's declaration, and which toolkit's code runs on which
 * platform is the compiler's to check (platformScopes). A toolkit
 * whose platform is untyped here is left out: its module is
 * (untypedSdkText).
 */
function jsxRuntimeText(): string {
  const typed = (Object.keys(TOOLKITS) as ToolkitName[]).filter((t) =>
    platformSdkTyped(TOOLKITS[t].platform),
  );
  const elements = typed.map((t) => TOOLKITS[t].element);
  // The typed platforms' views are tags too (T48), and an element is any of them at once.
  const platforms = PLATFORMS.filter((p) => platformSdkTyped(p));
  const { imports: rootImports, types: roots } = rootViews(platforms);

  return dts.printUnit({
    banner: "The JSX of a shared Lucent file: each platform's toolkit's, in its code.",
    decls: [
      ...typed.map((t) => ({
        k: "importType" as const,
        names: [TOOLKITS[t].element],
        from: `lucent:${t}`,
      })),
      { k: "importType", names: NATIVE_JSX_UI, from: "lucent:ui" },
      ...rootImports,
      {
        k: "namespace",
        name: "JSX",
        decls: [
          {
            k: "typeAlias",
            name: "Element",
            type:
              elements.length || roots.length
                ? dts.intersection([...elements.map((e) => dts.ref(e)), ...roots])
                : dts.keyword("unknown"),
          },
          // A tag is a component of either toolkit: it makes that toolkit's element. An
          // untyped toolkit's tags (its module untyped) are any component.
          {
            k: "typeAlias",
            name: "ElementType",
            type: dts.union([
              ...elements.map((e) =>
                dts.fn([dts.param("props", dts.keyword("never"))], dts.ref(e)),
              ),
              ...(typed.length < Object.keys(TOOLKITS).length
                ? [dts.fn([dts.param("props", dts.keyword("never"))], dts.keyword("unknown"))]
                : []),
              ...nativeTags(roots),
            ]),
          },
          ...nativeJsxDecls(),
          {
            k: "interface",
            name: "ElementChildrenAttribute",
            members: [{ k: "property", name: "children", type: dts.object([]) }],
          },
          { k: "interface", name: "IntrinsicElements", members: [] },
        ],
      },
      { k: "exportNothing" },
    ],
  });
}

/**
 * A program of Lucent modules. With a `platform`, it may contain that
 * platform's files and resolves its SDK modules; `references` are files the
 * checker sees (platform modules' shared declarations) that are not
 * compiled themselves.
 */
export function createLucentProgram(
  files: string[],
  readSource?: ReadSource,
  platform?: Platform,
  extra: { references?: string[]; stubs?: string[]; libCheck?: boolean } = {},
): LucentProgram {
  const references = extra.references ?? [];
  const stubs = new Set((extra.stubs ?? []).map((f) => path.resolve(f)));

  // The declaration audit checks the generated SDK declarations themselves,
  // which apps' tsconfigs (skipLibCheck) never do.
  const options = { ...compilerOptions(), skipLibCheck: !extra.libCheck };

  const direct = directSdkImports(files, readSource);
  const host = compilerHost(options, readSource, direct);
  const program = ts.createProgram(
    [
      ...files.map((f) => path.resolve(f)),
      ...references.map((f) => path.resolve(f)),
      globalsPath(),
      UNTYPED,
    ],
    options,
    host,
  );
  const checker = program.getTypeChecker();
  const diagnostics: Diagnostic[] = [];
  const modules: LucentModule[] = [];
  const names = new Map<string, string>();
  for (const file of files) {
    const sf = program.getSourceFile(path.resolve(file));
    if (!sf) continue;
    const name = moduleNameOf(file);
    const clash = names.get(name);
    if (clash) {
      diagnostics.push({
        code: Codes.ModuleNameClash,
        message: `two Lucent modules are named "${name}": ${clash} and ${file}`,
        file,
      });
      continue;
    }
    names.set(name, file);
    const declaration = platformOf(file)
      ? references
          .map((r) => program.getSourceFile(path.resolve(r)))
          .find(
            (r) =>
              r &&
              path.dirname(r.fileName) === path.dirname(sf.fileName) &&
              moduleNameOf(r.fileName) === name,
          )
      : undefined;
    modules.push({
      name,
      file: sf.fileName,
      sourceFile: sf,
      ns: moduleNamespace(name),
      declaration,
      stub: stubs.has(path.resolve(file)),
    });
  }
  const checked = [
    ...modules.map((m) => m.sourceFile),
    ...references
      .map((f) => program.getSourceFile(path.resolve(f)))
      .filter((sf): sf is ts.SourceFile => !!sf),
  ];
  for (const sf of checked) {
    const bad = importDiagnostics(sf, platform);
    diagnostics.push(...bad);
    for (const d of [
      ...program.getSyntacticDiagnostics(sf),
      ...program.getSemanticDiagnostics(sf),
    ]) {
      // An SDK import this program cannot resolve is reported once, as a Lucent error.
      if (
        d.code === 2307 &&
        bad.some(
          (b) =>
            b.start !== undefined &&
            d.start !== undefined &&
            d.start >= b.start &&
            d.start < b.start + (b.length ?? 0),
        )
      )
        continue;
      const hint: { message: string; fix: string; quickFix?: QuickFix } | undefined =
        nativeMemberHint(d, checker, direct) ??
        nativeAttributeHint(d, checker) ??
        initializerFactoryHint(d, checker) ??
        inheritedInitializerHint(d, checker, direct);
      const diagnostic = fromTs(d);
      diagnostics.push(
        hint
          ? {
              ...diagnostic,
              message: `${diagnostic.message} ${hint.message}`,
              fix: hint.fix,
              ...(hint.quickFix ? { quickFix: hint.quickFix } : {}),
            }
          : diagnostic,
      );
    }
  }
  return { program, platform, checker, modules, diagnostics };
}

/** TypeScript's errors for a member a type does not have (2551: with a suggestion). */
const MISSING_MEMBER = new Set([2339, 2551]);

/**
 * What to do about a member a native library's type does not have: import
 * its module, when only its name is known (an iOS module only named in
 * other modules' signatures); wrap it, when the module has it but Lucent
 * does not bind it; else use what the installed version declares or
 * install one that has it. Undefined for any other error, and for a member
 * the SDK's own types lack, whose version the app does not choose.
 */
function nativeMemberHint(
  d: ts.Diagnostic,
  checker: ts.TypeChecker,
  direct: Set<string>,
): { message: string; fix: string } | undefined {
  if (!MISSING_MEMBER.has(d.code) || !d.file || d.start === undefined) return undefined;

  const name = nodeAt(d.file, d.start);
  const access = name.parent;
  if (!ts.isIdentifier(name) || !access || !ts.isPropertyAccessExpression(access)) return undefined;

  const type = checker.getTypeAtLocation(access.expression);
  const symbol = type.getSymbol() ?? type.aliasSymbol;
  const declared = symbol?.declarations?.[0]?.getSourceFile();
  const sdk = declared && sdkModuleOf(declared);
  if (!symbol || !sdk) return undefined;

  const spec = `lucent:${sdk.platform}/${sdk.module}`;
  if (sdk.platform === "ios" && !direct.has(`${sdk.platform}/${sdk.module}`))
    return {
      message: `${symbol.name} is ${spec}'s, which no file imports: only its name is known.`,
      fix: `import from ${spec} (a type import is enough) to use ${symbol.name}'s members`,
    };

  const found = sdkLookup(sdk.platform, sdk.module);
  const schema = "schema" in found ? found.schema : undefined;
  const provenance = schema?.provenance;
  if (!schema || !provenance) return undefined;

  const skipped = skippedMember(schema, symbol.name, name.text);
  if (skipped)
    return {
      message: `${skipped.api} is in ${provenance.artifact}, but Lucent does not bind it: ${skipped.reason}.`,
      fix: WRAP_UNBOUND[sdk.platform],
    };

  if (provenance.kind === "sdk") return undefined;

  return {
    message: `${symbol.name} is ${spec}'s, from ${provenance.artifact} as installed, which has no ${name.text}.`,
    fix: `use what ${symbol.name} declares in this version of ${sdk.module}, or install a version that has ${name.text}`,
  };
}

/** TypeScript's error for a protected constructor called from outside. */
const PROTECTED_CONSTRUCTOR = 2674;

/** A quick fix adding `import "spec";` after `file`'s last import (at its top without one). */
function importing(file: ts.SourceFile, spec: string): QuickFix {
  const last = file.statements.filter(ts.isImportDeclaration).at(-1);
  const line = `import "${spec}";`;

  return {
    title: `Add import "${spec}"`,
    edits: [
      last
        ? { start: last.getEnd(), length: 0, text: `\n${line}` }
        : { start: 0, length: 0, text: `${line}\n` },
    ],
  };
}

/**
 * Where `new` of a native class reaches the constructor of a superclass
 * whose module no file imports (only its name is known, so it declares
 * none): the initializers the class inherits are that superclass's, and
 * importing its module declares them.
 */
function inheritedInitializerHint(
  d: ts.Diagnostic,
  checker: ts.TypeChecker,
  direct: Set<string>,
): { message: string; fix: string; quickFix: QuickFix } | undefined {
  if (d.code !== PROTECTED_CONSTRUCTOR && !NO_OVERLOAD.has(d.code)) return undefined;
  if (!d.file || d.start === undefined) return undefined;

  let at: ts.Node | undefined = nodeAt(d.file, d.start);
  while (at && !ts.isNewExpression(at)) at = at.parent;
  if (!at || !ts.isNewExpression(at)) return undefined;

  const named = checker.getSymbolAtLocation(at.expression);
  const symbol =
    named && named.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(named) : named;
  const declared = symbol?.declarations?.[0]?.getSourceFile();
  const sdk = declared && sdkModuleOf(declared);
  if (!symbol || !sdk) return undefined;

  // Up the classes that inherit their initializers, to the one declaring them.
  let module = sdk.module;
  let name = symbol.name;
  for (let depth = 0; depth < 32; depth++) {
    const found = sdkLookup(sdk.platform, module);
    const cls =
      "schema" in found
        ? found.schema.types.find((t) => t.kind === "class" && t.name === name)
        : undefined;
    if (cls?.kind !== "class" || cls.constructors?.length || !cls.inheritsInit || !cls.extends)
      break;

    const up = parseSdkType(cls.extends, module);
    if (up.k !== "ref") break;
    [module, name] = [up.module, up.name];

    const spec = `lucent:${sdk.platform}/${module}`;
    if (module !== sdk.module && !direct.has(`${sdk.platform}/${module}`))
      return {
        message: `${symbol.name}'s initializers are ${name}'s, inherited from ${spec}, which no file imports: only its name is known.`,
        fix: `import "${spec}" (a bare import is enough) to make a ${symbol.name} with ${name}'s initializers`,
        quickFix: importing(d.file, spec),
      };
  }

  return undefined;
}

/** TypeScript's errors for a call no overload takes. */
const NO_OVERLOAD = new Set([2554, 2769, 2345]);

/**
 * Where `new` of a native class takes none of the arguments: its Swift
 * initializers TypeScript cannot tell apart (the same types, other
 * labels) are its static factories, which the error names.
 */
function initializerFactoryHint(
  d: ts.Diagnostic,
  checker: ts.TypeChecker,
): { message: string; fix: string } | undefined {
  if (!NO_OVERLOAD.has(d.code) || !d.file || d.start === undefined) return undefined;

  let at: ts.Node | undefined = nodeAt(d.file, d.start);
  while (at && !ts.isNewExpression(at)) at = at.parent;
  if (!at || !ts.isNewExpression(at)) return undefined;

  const named = checker.getSymbolAtLocation(at.expression);
  const symbol =
    named && named.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(named) : named;
  const declared = symbol?.declarations?.[0]?.getSourceFile();
  const sdk = declared && sdkModuleOf(declared);
  if (!symbol || !sdk) return undefined;

  const found = sdkLookup(sdk.platform, sdk.module);
  const cls =
    "schema" in found
      ? found.schema.types.find((t) => t.kind === "class" && t.name === symbol.name)
      : undefined;
  const factories =
    cls?.kind === "class"
      ? (cls.methods ?? []).filter((m) => m.static && m.swift?.name.startsWith("init("))
      : [];
  if (!factories.length) return undefined;

  const listed = factories.map((f) => `${symbol.name}.${f.name}(…) for ${f.swift!.name}`);
  return {
    message: `${symbol.name}'s initializers that take the same types are its static factories, which TypeScript tells apart: ${listed.join(", ")}.`,
    fix: `call the one you mean: ${symbol.name}.${factories[0]!.name}(…)`,
  };
}

/**
 * The member `owner.member` the module's extractor skipped, as it names it
 * (`Owner.member(…)`, or the class's full name on Android), and why.
 */
function skippedMember(
  schema: SdkModuleSchema,
  owner: string,
  member: string,
): { api: string; reason: string } | undefined {
  for (const entry of schema.skipped ?? []) {
    const at = entry.indexOf(": ");
    const api = entry.slice(0, at);
    const [type, name] = api.split("(")[0]!.split(/\.(?=[^.]*$)/);

    if (name === member && (type === owner || type?.endsWith(`.${owner}`)))
      return { api, reason: entry.slice(at + 2) };
  }

  return undefined;
}

/**
 * What to do about an attribute a native view's tag does not take (T48),
 * where its class's rules leave it out: the reason, and that setup code
 * can call it on a view the element's `create` gives. Undefined for any
 * other error.
 */
function nativeAttributeHint(
  d: ts.Diagnostic,
  checker: ts.TypeChecker,
): { message: string; fix: string } | undefined {
  if (!MISSING_ATTRIBUTE.has(d.code) || !d.file || d.start === undefined) return undefined;

  let element: ts.Node | undefined = nodeAt(d.file, d.start);
  while (element && !ts.isJsxOpeningElement(element) && !ts.isJsxSelfClosingElement(element))
    element = element.parent;
  if (!element) return undefined;

  const type = nativeTagType(checker, ts.isJsxOpeningElement(element) ? element.parent : element);
  const decl = type?.getSymbol()?.declarations?.[0];
  const ref = decl && classOfDecl(decl);
  const schema = ref && findSdkModule(ref.platform, ref.module);
  if (!ref || !schema) return undefined;

  const tag = viewTag(ref.cls, schema, (m) => findSdkModule(ref.platform, m));
  for (const a of element.attributes.properties) {
    const name = ts.isJsxAttribute(a) ? a.name.getText() : undefined;
    const reason = name && tag.refused.get(name);

    if (reason)
      return {
        message: `<${ref.cls.name}> does not take ${name}: ${reason}.`,
        fix: `call it in setup code, on the view made with create={() => new ${ref.cls.name}(…)}`,
      };
  }

  return undefined;
}

/** TypeScript's errors for an attribute a tag does not take (2769: one per constructor tried). */
const MISSING_ATTRIBUTE = new Set([2322, 2769]);

/** The innermost node at `pos`. */
export function nodeAt(sf: ts.SourceFile, pos: number): ts.Node {
  let node: ts.Node = sf;
  for (let inner: ts.Node | undefined = sf; inner;) {
    node = inner;
    inner = ts.forEachChild(node, (c) =>
      c.getStart(sf) <= pos && pos < c.getEnd() ? c : undefined,
    );
  }

  return node;
}

/**
 * `lucent:` imports this file may not use: another platform's in a platform
 * file, and unknown SDK modules. Shared files import every platform's (their
 * branches decide where each is used); a platform whose SDK is not installed,
 * or whose imports are deferred, is untyped there, unless the program targets it.
 */
function importDiagnostics(sf: ts.SourceFile, platform: Platform | undefined): Diagnostic[] {
  const shared = !platformOf(sf.fileName);
  const out: Diagnostic[] = [];
  for (const s of sf.statements) {
    if (!ts.isImportDeclaration(s) || !ts.isStringLiteral(s.moduleSpecifier)) continue;
    const spec = s.moduleSpecifier.text;
    const m = /^lucent:(\w+)(?:\/(.+))?$/.exec(spec);
    if (!m) continue;
    const [, scope, module] = m;
    let message: string | undefined;
    if ((scope === "core" || scope === "thread" || scope === "platform") && !module) continue;
    if (scope === "ui" && !module && fabricRequested()) continue;
    const toolkit = toolkitOfModule(`lucent:${scope}`);
    if (toolkit && !module && fabricRequested()) {
      const own = platformOf(sf.fileName);
      const home = TOOLKITS[toolkit].platform;
      const declarations = toolkitSource(toolkit) ? toolkitDeclarations(toolkit) : undefined;
      if (own === home && declarations && "missing" in declarations)
        out.push({
          ...at(sf, s.moduleSpecifier),
          code: Codes.SdkImport,
          message: `${spec} is generated from ${TOOLKITS[toolkit].title}'s declarations: ${declarations.missing}`,
        });
      if (!own || own === home) continue;
      out.push({
        ...at(sf, s.moduleSpecifier),
        code: Codes.SdkImport,
        message: `${spec} is ${PLATFORM_NAMES[home]}'s: import it in an ${PLATFORM_NAMES[home]} module (.${home}.lucent.ts or .${home}.lucent.tsx)`,
      });
      continue;
    }
    const target = scope as Platform;
    if (scope === "ext") {
      if (module && findExtension(module)) continue;

      const known = boundExtensions().map((e) => e.name);
      out.push({
        ...at(sf, s.moduleSpecifier),
        code: Codes.SdkImport,
        message: module
          ? `${spec}: no Lucent package declares the extension ${module} (${known.length ? `the app's extensions: ${known.join(", ")}` : "the app has none"})`
          : "lucent:ext needs an extension name: lucent:ext/<name>",
        fix: "install the Lucent package that declares the extension (its lucent.json extensions)",
      });
      continue;
    } else if (!(PLATFORMS as readonly string[]).includes(scope!))
      message = `${spec} is not a Lucent module`;
    else if (!shared && scope !== platform)
      message = `${spec} is only available in *.${scope}.lucent.ts files, or in shared files inside \`if (PLATFORM === "${scope}")\``;
    else if (module && (target === platform || platformSdkTyped(target))) {
      const found = sdkLookup(target, module);
      if ("missing" in found) message = found.missing;
      else continue;
    } else continue;
    out.push({ ...at(sf, s.moduleSpecifier), code: Codes.SdkImport, message });
  }
  return out;
}

function at(
  sf: ts.SourceFile,
  node: ts.Node,
): Pick<Diagnostic, "file" | "line" | "column" | "start" | "length"> {
  const start = node.getStart(sf);
  const { line, character } = sf.getLineAndCharacterOfPosition(start);
  return {
    file: sf.fileName,
    line: line + 1,
    column: character + 1,
    start,
    length: node.getEnd() - start,
  };
}

function fromTs(d: ts.Diagnostic): Diagnostic {
  const message = ts.flattenDiagnosticMessageText(d.messageText, "\n");
  if (d.file && d.start !== undefined) {
    const { line, character } = d.file.getLineAndCharacterOfPosition(d.start);
    return {
      code: Codes.TypeScript,
      message: `TS${d.code}: ${message}`,
      file: d.file.fileName,
      line: line + 1,
      column: character + 1,
      start: d.start,
      length: d.length ?? 0,
    };
  }
  return { code: Codes.TypeScript, message: `TS${d.code}: ${message}` };
}
