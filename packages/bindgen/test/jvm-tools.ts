/**
 * The JVM tools the tests run (kotlinc, javac, jar), kept warm. Starting a
 * JVM costs more than most of what the tests ask of these tools (kotlinc
 * about two seconds before it reads a file): each test process starts one
 * tool server (jvm-tools/ToolServer.java, built here with javac) and sends
 * it the command lines, which it runs with the same compiler and tools,
 * answering what the command would. A process where the server cannot
 * start, or stops answering, runs the commands themselves.
 */
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { KotlinToolchain } from "./kotlin-toolchain.ts";

/** What a command exits with, and what it printed. */
export interface ToolResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

const here = path.join(import.meta.dirname, "jvm-tools");

/** The client's exit code when the server does not answer (see client.ts). */
const UNREACHABLE = 99;

/** The jars kotlinc's launcher puts on the compiler's classpath. */
const KOTLIN_JARS = [
  "kotlin-compiler.jar",
  "kotlin-stdlib.jar",
  "kotlin-reflect.jar",
  "kotlin-script-runtime.jar",
  "annotations-13.0.jar",
  "kotlinx-coroutines-core-jvm.jar",
];

/**
 * This process's server: its socket, null when it could not start. Kept on
 * the process, not this module: vitest imports the module again for each
 * test file, and a server per file would pile up JVMs in each worker.
 */
const state = ((globalThis as Record<symbol, unknown>)[Symbol.for("lucent.jvm-tools")] ??= {}) as {
  socket?: string | null;
};

const sleep = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/** A JDK tool: $JAVA_HOME's, else the one on the PATH. */
const jdkTool = (name: string) =>
  process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, "bin", name) : name;

/** Where kotlinc's libraries are, as kotlinToolchain finds them, without running kotlinc. */
function kotlinLib(): string | undefined {
  const found = spawnSync("sh", ["-c", "command -v kotlinc"], { encoding: "utf8" });
  if (found.status !== 0) return undefined;

  const bin = path.dirname(fs.realpathSync(found.stdout.trim()));

  return [
    process.env.KOTLIN_HOME && path.join(process.env.KOTLIN_HOME, "lib"),
    path.join(bin, "../lib"),
    path.join(bin, "../libexec/lib"),
  ].find((dir) => dir && fs.existsSync(path.join(dir, "kotlin-compiler.jar"))) as
    | string
    | undefined;
}

/** ToolServer's classes, compiled once per test run (published by rename). */
function serverClasses(): string | undefined {
  const source = path.join(here, "ToolServer.java");
  const key = crypto
    .createHash("sha256")
    .update(fs.readFileSync(source))
    .update(jdkTool("javac"))
    .digest("hex")
    .slice(0, 16);
  const classes = path.join(os.tmpdir(), `lucent-tool-server-${key}`);

  if (fs.existsSync(classes)) return classes;

  const work = `${classes}.${process.pid}`;
  const javac = spawnSync(jdkTool("javac"), ["-d", work, source], { encoding: "utf8" });

  if (javac.status !== 0) return undefined;

  try {
    fs.renameSync(work, classes);
  } catch {
    // Another process published it first.
    fs.rmSync(work, { recursive: true, force: true });
  }
  return classes;
}

/** The socket of this process's server, started on first use; undefined when it cannot. */
function server(): string | undefined {
  if (state.socket !== undefined) return state.socket ?? undefined;

  const classes = serverClasses();
  // A short path: a Unix socket's must fit in about a hundred bytes.
  const at = classes && path.join(fs.mkdtempSync("/tmp/lucent-jvm-"), "socket");
  let child: ChildProcess | undefined;

  if (classes && at) {
    const lib = kotlinLib();
    const kotlin = lib
      ? KOTLIN_JARS.map((j) => path.join(lib, j)).filter((j) => fs.existsSync(j))
      : [];

    child = spawn(
      jdkTool("java"),
      [
        "-Xmx1G",
        ...(lib ? [`-Dkotlin.home=${path.dirname(lib)}`] : []),
        "-cp",
        [...kotlin, classes].join(path.delimiter),
        "ToolServer",
        at,
      ],
      { stdio: ["pipe", "ignore", "ignore"] },
    );
    // The server ends when this process does (its standard input closes), without keeping it.
    child.unref();
    (child.stdin as unknown as { unref(): void }).unref();

    for (let waited = 0; waited < 30_000 && child.exitCode === null; waited += 50) {
      if (fs.existsSync(at)) break;
      sleep(50);
    }
  }

  const started = !!at && fs.existsSync(at) && child?.exitCode === null;
  state.socket = started ? at : null;

  return started ? at : undefined;
}

/** Whether this process runs the JVM tools in a warm server (starting it if need be). */
export function warmJvm(): boolean {
  return server() !== undefined;
}

/** `tool` run with `args` (absolute paths) by the warm server, else as `command`. */
function run(tool: string, command: string, args: string[]): ToolResult {
  const at = args.some((a) => /[\t\n]/.test(a)) ? undefined : server();

  if (at) {
    const r = spawnSync(process.execPath, [path.join(here, "client.ts"), at, tool, ...args], {
      encoding: "utf8",
      maxBuffer: 1 << 26,
    });

    if (r.status !== UNREACHABLE) return { status: r.status, stdout: r.stdout, stderr: r.stderr };

    // The server went away: the commands from now on.
    state.socket = null;
  }

  const r = spawnSync(command, args, { encoding: "utf8", maxBuffer: 1 << 26 });

  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

/** kotlinc `args` (absolute paths). */
export const runKotlinc = (tc: KotlinToolchain, args: string[]): ToolResult =>
  run("kotlinc", tc.kotlinc, args);

/** javac `args` (absolute paths). */
export const runJavac = (args: string[]): ToolResult => run("javac", "javac", args);

/** jar `args` (absolute paths). */
export const runJar = (args: string[]): ToolResult => run("jar", "jar", args);
