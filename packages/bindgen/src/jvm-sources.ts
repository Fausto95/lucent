/**
 * A Lucent package's own Kotlin and Java (android.nativeSources), compiled
 * for Lucent to read (decision 0132). The files compile into one jar, against the
 * platform's android.jar and the app's resolved classpath, the first time
 * Lucent code imports a Java package they declare; each such package binds
 * from that jar as a library's does. The jar is kept in the cache under a
 * key of the sources' contents, the classpath's and the compilers'. Gradle
 * compiles the same sources into the app.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { cacheRoot, hash, publishDir } from "./cache.ts";
import { contentHash, JVM_SOURCES_DIR, jvmSourcesJarName } from "./provenance.ts";
import { ZipArchive } from "./zip.ts";

/** The `.kt` and `.java` files under `dirs`, sorted; hidden directories and node_modules aside. */
export function jvmFilesUnder(dirs: string[]): string[] {
  const out = new Set<string>();
  const walk = (dir: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith(".") || e.name === "node_modules") continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (/\.(kt|java)$/.test(e.name)) out.add(full);
    }
  };
  for (const d of dirs) walk(d);

  return [...out].sort();
}

/**
 * The Java package a Kotlin or Java file declares (`package a.b`, after
 * comments and file annotations), undefined for the default package.
 */
export function packageOf(text: string): string | undefined {
  const code = text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, "");
  const m = /^\s*package\s+([\w`.\s]+?)\s*(?:;|$)/m.exec(code);

  return m ? m[1]!.replace(/[`\s]/g, "") : undefined;
}

/** The Java packages `files` declare, sorted. */
export function packagesOf(files: string[]): string[] {
  const out = new Set<string>();
  for (const f of files) {
    const pkg = packageOf(fs.readFileSync(f, "utf8"));
    if (pkg) out.add(pkg);
  }

  return [...out].sort();
}

// --- the compilers -------------------------------------------------------------------

/** A compiler: the start of its command line, and what names it in keys. */
export interface JvmTool {
  command: string[];
  identity: string;
  /** The Kotlin standard library it compiles against when the classpath has none. */
  stdlib?: string;
}

export interface JvmCompilers {
  kotlinc?: JvmTool;
  javac?: JvmTool;
  jar?: JvmTool;
}

/** The executable `name` on the PATH (`name.bat`, `name.cmd` or `name.exe` on Windows). */
function onPath(name: string): string | undefined {
  const names =
    process.platform === "win32" ? [`${name}.exe`, `${name}.bat`, `${name}.cmd`] : [name];

  for (const dir of (process.env.PATH ?? "").split(path.delimiter).filter(Boolean))
    for (const n of names) {
      const file = path.join(dir, n);
      try {
        if (fs.statSync(file).isFile()) return file;
      } catch {
        // Not here.
      }
    }

  return undefined;
}

/** A JDK tool: $JAVA_HOME's, else the PATH's. */
function jdkTool(name: string): string | undefined {
  const home = process.env.JAVA_HOME;
  const exe = process.platform === "win32" ? `${name}.exe` : name;
  if (home && fs.existsSync(path.join(home, "bin", exe))) return path.join(home, "bin", exe);

  return onPath(name);
}

/** An executable's identity: its real path, and its compiler jar's stats when kotlinc's. */
function executableIdentity(file: string): string {
  const real = fs.realpathSync(file);
  const compiler = path.join(path.dirname(real), "../lib/kotlin-compiler.jar");
  if (!fs.existsSync(compiler)) return real;

  const st = fs.statSync(compiler);
  return `${real} ${st.size} ${Math.floor(st.mtimeMs)}`;
}

const tool = (file: string | undefined): JvmTool | undefined =>
  file ? { command: [file], identity: executableIdentity(file) } : undefined;

/**
 * The compilers: Kotlin's from $KOTLINC, else the app's Gradle build's
 * (`compilerClasspath`, the jars its Kotlin plugin resolved, run with the
 * JDK's java), else kotlinc on the PATH; the JDK's javac and jar.
 */
export function jvmCompilers(compilerClasspath: string[] = []): JvmCompilers {
  const java = jdkTool("java");
  const gradle = compilerClasspath.length && compilerClasspath.every((j) => fs.existsSync(j));
  const stdlib = compilerClasspath.find(isStdlib);

  const kotlinc = process.env.KOTLINC
    ? tool(fs.existsSync(process.env.KOTLINC) ? process.env.KOTLINC : onPath(process.env.KOTLINC))
    : gradle && java
      ? {
          command: [
            java,
            "-cp",
            compilerClasspath.join(path.delimiter),
            "org.jetbrains.kotlin.cli.jvm.K2JVMCompiler",
          ],
          identity: `gradle ${compilerClasspath.map((j) => path.basename(j)).join(" ")}`,
          ...(stdlib ? { stdlib } : {}),
        }
      : tool(onPath("kotlinc"));

  const javac = tool(jdkTool("javac"));
  const jar = tool(jdkTool("jar"));

  return { ...(kotlinc ? { kotlinc } : {}), ...(javac ? { javac } : {}), ...(jar ? { jar } : {}) };
}

/** Whether a jar is the Kotlin standard library (Gradle's `kotlin-stdlib-2.1.0.jar`, kotlinc's `kotlin-stdlib.jar`). */
const isStdlib = (jar: string) => /^kotlin-stdlib(-\d[^/\\]*)?\.jar$/.test(path.basename(jar));

// --- the jar -------------------------------------------------------------------------

/** The sources, planned: where their jar is once built, and what it is built from. */
export interface JvmSourcesPlan {
  files: string[];
  /** The Java packages they declare: the modules the jar binds. */
  packages: string[];
  /** Their contents' hash, the same on any machine: their artifact's, in keys and locks. */
  contentHash: string;
  /** The jar's key: their contents, and the classpath's and compilers' on this machine. */
  key: string;
  jar: string;
  /** The jars and AARs they compile against: the platform's first. */
  classpath: string[];
  compilers: JvmCompilers;
  cacheDir: string;
}

/**
 * Plans the jar of `files` (the packages' .kt and .java), against
 * `classpath`, whose artifacts' identities `classpathKey` sums; nothing is
 * compiled until buildJvmSources.
 */
export function planJvmSources(
  files: string[],
  classpath: string[],
  opts: { cacheDir?: string; classpathKey: string; compilerClasspath?: string[] },
): JvmSourcesPlan {
  const compilers = jvmCompilers(opts.compilerClasspath);
  const sources = hash([
    "jvm-sources",
    contentHash(files),
    ...files.map((f) => path.basename(f)).sort(),
  ]);
  const key = hash([
    "jvm-sources 1",
    sources,
    opts.classpathKey,
    compilers.kotlinc?.identity ?? "",
    compilers.javac?.identity ?? "",
  ]);
  const root = cacheRoot(opts.cacheDir);

  return {
    files,
    packages: packagesOf(files),
    contentHash: sources,
    key,
    jar: path.join(root, JVM_SOURCES_DIR, key, jvmSourcesJarName(sources)),
    classpath,
    compilers,
    cacheDir: root,
  };
}

/** Why each plan's sources did not compile, in this process: one failure is not compiled again. */
const failures = new Map<string, string>();

/**
 * Builds a plan's jar, unless it is in the cache already (any process's):
 * Kotlin first, seeing the Java sources, then Java against its classes.
 * Undefined once the jar is there; else why it is not, with the
 * compiler's errors.
 */
export function buildJvmSources(plan: JvmSourcesPlan): string | undefined {
  if (fs.existsSync(plan.jar)) return undefined;
  const failed = failures.get(plan.key);
  if (failed) return failed;

  const kotlin = plan.files.filter((f) => f.endsWith(".kt"));
  const java = plan.files.filter((f) => f.endsWith(".java"));
  const { kotlinc, javac, jar } = plan.compilers;
  const why = !jar
    ? "no JDK was found to compile them: install one and set JAVA_HOME"
    : kotlin.length && !kotlinc
      ? process.env.KOTLINC
        ? `they are Kotlin, and KOTLINC is ${process.env.KOTLINC}, which was not found`
        : "they are Kotlin, and no Kotlin compiler was found: set KOTLINC to kotlinc, install it (brew install kotlin), or build the app's Android project once, so Gradle resolves its Kotlin compiler"
      : java.length && !javac
        ? "they are Java, and no javac was found: install a JDK and set JAVA_HOME"
        : undefined;
  if (why) {
    failures.set(plan.key, why);
    return why;
  }

  try {
    publishDir(path.dirname(plan.jar), (tmp) => {
      const classes = path.join(tmp, "classes");
      fs.mkdirSync(classes);
      const cp = compileClasspath(plan);

      if (kotlin.length) {
        // The app's standard library, else the compiler's own: never both.
        const listed = cp.some(isStdlib);
        const stdlib = listed ? undefined : kotlinc!.stdlib;
        run("kotlinc", kotlinc!, tmp, [
          "-d",
          classes,
          "-classpath",
          [...cp, ...(stdlib ? [stdlib] : [])].join(path.delimiter),
          ...(listed || stdlib ? ["-no-stdlib", "-no-reflect"] : []),
          "-java-parameters",
          "-nowarn",
          ...kotlin,
          ...java,
        ]);
      }

      if (java.length)
        run("javac", javac!, tmp, [
          "-d",
          classes,
          "-classpath",
          [...cp, classes].join(path.delimiter),
          "-proc:none",
          "-parameters",
          "-nowarn",
          "-encoding",
          "UTF-8",
          ...java,
        ]);

      run("jar", jar!, tmp, ["cf", path.join(tmp, path.basename(plan.jar)), "-C", classes, "."]);
      fs.rmSync(classes, { recursive: true, force: true });
    });
  } catch (e) {
    const message = (e as Error).message;
    failures.set(plan.key, message);
    return message;
  }

  return undefined;
}

/** Runs a compiler with `args` from an argument file (a classpath may be longer than a command line). */
function run(name: string, t: JvmTool, tmp: string, args: string[]): void {
  const quote = (a: string) => `"${a.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  const argfile = path.join(tmp, `${name}.args`);
  fs.writeFileSync(argfile, args.map(quote).join("\n"));

  const [cmd, ...first] = t.command;
  const r = spawnSync(cmd!, [...first, `@${argfile}`], {
    encoding: "utf8",
    maxBuffer: 1 << 26,
    // A .bat or .cmd runs in a shell (kotlinc on Windows).
    shell: /\.(bat|cmd)$/i.test(cmd!),
  });
  if (r.status === 0) return;

  throw new Error(`${name}: ${errorsOf(`${r.stderr ?? ""}${r.stdout ?? ""}`, r.error)}`);
}

/** A compiler's errors: its error lines (five at most), else its last lines. */
export function errorsOf(output: string, error?: Error): string {
  const lines = output
    .split("\n")
    .map((l) => l.trimEnd())
    .filter((l) => l && !l.startsWith("Picked up JAVA_TOOL_OPTIONS"));
  const errors = lines.filter((l) => /(^|: )error: |^e: /.test(l));

  return (
    (errors.length ? errors.slice(0, 5) : lines.slice(-10)).join("\n") ||
    error?.message ||
    "it exited with an error"
  );
}

/** The plan's classpath as compilers read it: each AAR as its class jars, extracted once into the cache. */
function compileClasspath(plan: JvmSourcesPlan): string[] {
  return plan.classpath.flatMap((f) => (f.endsWith(".aar") ? aarJars(plan.cacheDir, f) : [f]));
}

/** An AAR's class jars (classes.jar, libs/*.jar), extracted once per AAR (its path and stats). */
function aarJars(root: string, aar: string): string[] {
  const st = fs.statSync(aar);
  const dir = path.join(
    root,
    "aar-classes",
    hash([aar, String(st.size), String(Math.floor(st.mtimeMs))]),
  );

  publishDir(dir, (tmp) => {
    const zip = new ZipArchive(aar);
    for (const n of zip.names()) {
      if (n !== "classes.jar" && !/^libs\/[^/]+\.jar$/.test(n)) continue;
      fs.writeFileSync(path.join(tmp, n.replace("/", "-")), zip.read(n)!);
    }
  });

  return fs
    .readdirSync(dir)
    .sort()
    .map((f) => path.join(dir, f));
}
