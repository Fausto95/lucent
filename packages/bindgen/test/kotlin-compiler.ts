/**
 * kotlinc, kept warm. Starting the compiler's JVM costs about two seconds,
 * more than most of the compiles the tests make: each test process starts
 * one compiler server (kotlin-server/KotlinServer.java, built here with
 * javac) and sends it the arguments kotlinc would get, which it compiles
 * with the same compiler, printing what kotlinc prints. A process where the
 * server cannot start runs kotlinc itself.
 */
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { KotlinToolchain } from "./kotlin-toolchain.ts";

/** What kotlinc exits with, and what it printed. */
export interface KotlinResult {
  status: number | null;
  stderr: string;
}

const here = path.join(import.meta.dirname, "kotlin-server");

/** The jars kotlinc's launcher puts on the compiler's classpath. */
const COMPILER_JARS = [
  "kotlin-compiler.jar",
  "kotlin-stdlib.jar",
  "kotlin-reflect.jar",
  "kotlin-script-runtime.jar",
  "annotations-13.0.jar",
  "kotlinx-coroutines-core-jvm.jar",
];

/** This process's server, by toolchain: its socket, or null when it could not start. */
const servers = new Map<string, string | null>();

const sleep = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/** KotlinServer's classes for `tc`, compiled once per test run (published by rename). */
function serverClasses(tc: KotlinToolchain): string | undefined {
  const source = path.join(here, "KotlinServer.java");
  const key = crypto
    .createHash("sha256")
    .update(fs.readFileSync(source))
    .update(tc.lib)
    .update(tc.version)
    .digest("hex")
    .slice(0, 16);
  const classes = path.join(os.tmpdir(), `lucent-kotlin-server-${key}`);

  if (fs.existsSync(classes)) return classes;

  const work = `${classes}.${process.pid}`;
  const javac = spawnSync(
    tc.javac,
    ["-cp", path.join(tc.lib, "kotlin-compiler.jar"), "-d", work, source],
    { encoding: "utf8" },
  );

  if (javac.status !== 0) return undefined;

  try {
    fs.renameSync(work, classes);
  } catch {
    // Another process published it first.
    fs.rmSync(work, { recursive: true, force: true });
  }
  return classes;
}

/** The socket of this process's server for `tc`, started on first use; undefined when it cannot. */
function server(tc: KotlinToolchain): string | undefined {
  const known = servers.get(tc.lib);
  if (known !== undefined) return known ?? undefined;

  const classes = serverClasses(tc);
  // A short path: a Unix socket's must fit in about a hundred bytes.
  const socket = classes && path.join(fs.mkdtempSync("/tmp/lucent-kotlinc-"), "socket");
  let child: ChildProcess | undefined;

  if (classes && socket) {
    const classpath = [
      ...COMPILER_JARS.map((j) => path.join(tc.lib, j)).filter((j) => fs.existsSync(j)),
      classes,
    ];

    child = spawn(
      tc.java,
      [
        "-Xmx1G",
        `-Dkotlin.home=${path.dirname(tc.lib)}`,
        "-cp",
        classpath.join(path.delimiter),
        "KotlinServer",
        socket,
      ],
      { stdio: ["pipe", "ignore", "ignore"] },
    );
    // The server ends when this process does (its standard input closes), without keeping it.
    child.unref();
    (child.stdin as unknown as { unref(): void }).unref();

    for (let waited = 0; waited < 30_000 && child.exitCode === null; waited += 50) {
      if (fs.existsSync(socket)) break;
      sleep(50);
    }
  }

  const started = !!socket && fs.existsSync(socket) && child?.exitCode === null;
  servers.set(tc.lib, started ? socket! : null);

  return started ? socket : undefined;
}

/** Whether this process compiles Kotlin with a warm compiler for `tc` (starting it if need be). */
export function warmKotlin(tc: KotlinToolchain): boolean {
  return server(tc) !== undefined;
}

/** The client's exit code when the server does not answer (see client.ts). */
const UNREACHABLE = 99;

/** kotlinc `args` (absolute paths), compiled by this process's warm compiler. */
export function runKotlinc(tc: KotlinToolchain, args: string[]): KotlinResult {
  const socket = args.some((a) => /[\t\n]/.test(a)) ? undefined : server(tc);

  if (socket) {
    const r = spawnSync(process.execPath, [path.join(here, "client.ts"), socket, ...args], {
      encoding: "utf8",
      maxBuffer: 1 << 26,
    });

    if (r.status !== UNREACHABLE) return { status: r.status, stderr: r.stderr };

    // The server went away: kotlinc from now on.
    servers.set(tc.lib, null);
  }

  const r = spawnSync(tc.kotlinc, args, { encoding: "utf8", maxBuffer: 1 << 26 });

  return { status: r.status, stderr: r.stderr };
}
