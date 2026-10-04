/**
 * The files a compile reads from disk, each with what it found there: the
 * sources, the files their imports resolve to, the package.json files
 * resolution looks through and the one naming a module. A file looked
 * for and missing counts too: one created there may change what an import
 * resolves to. A result holds while every file is as the compile found it.
 *
 * Without TypeScript: package lookups read through here, and lucent doctor
 * makes them without loading it.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

let recording: Map<string, string> | undefined;

/** Runs `f`, and lists the files it read, each with what it found (see currentReads). */
export function recordReads<T>(f: () => T): { value: T; read: ReadonlyMap<string, string> } {
  const saved = recording;
  const read = new Map<string, string>();
  recording = read;

  try {
    return { value: f(), read };
  } finally {
    recording = saved;
  }
}

/** `file`'s text as TypeScript reads it, noted as read. */
export function readText(file: string): string | undefined {
  const bytes = contents(file);
  recording?.set(path.resolve(file), found(file, bytes));

  return bytes && decode(bytes);
}

/** Whether `file` exists, noted as read when it does not. */
export function fileExists(file: string): boolean {
  return stat(file)?.isFile() || missing(file);
}

/** Whether directory `dir` exists, noted as read when it does not. */
export function directoryExists(dir: string): boolean {
  return stat(dir)?.isDirectory() || missing(dir);
}

/** What each file holds now, as a compile reading it would note it. */
export function currentReads(files: Iterable<string>): Map<string, string> {
  return new Map([...files].map((f) => [f, found(f, contents(f))]));
}

/** A key of files and what each held: the same while each holds the same. */
export function readsKey(read: ReadonlyMap<string, string>): string {
  const hash = createHash("sha256");
  for (const file of [...read.keys()].sort()) hash.update(`${file}\0${read.get(file)}\0`);

  return hash.digest("hex");
}

function missing(file: string): false {
  recording?.set(path.resolve(file), found(file, undefined));

  return false;
}

/** What a read of `file` found: its content's hash, else a directory or nothing. */
function found(file: string, bytes: Buffer | undefined): string {
  if (bytes) return createHash("sha256").update(bytes).digest("hex").slice(0, 16);

  return stat(file)?.isDirectory() ? "directory" : "missing";
}

function contents(file: string): Buffer | undefined {
  try {
    return fs.readFileSync(file);
  } catch {
    return undefined;
  }
}

function stat(file: string): fs.Stats | undefined {
  try {
    return fs.statSync(file, { throwIfNoEntry: false });
  } catch {
    return undefined;
  }
}

/**
 * Text as TypeScript's sys.readFile decodes it: UTF-16 after a byte order
 * mark saying so (big-endian swapped), else UTF-8 past any mark.
 */
function decode(bytes: Buffer): string {
  if (bytes[0] === 0xfe && bytes[1] === 0xff)
    return Buffer.from(bytes.subarray(0, bytes.length & ~1))
      .swap16()
      .toString("utf16le", 2);
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return bytes.toString("utf16le", 2);
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return bytes.toString("utf8", 3);

  return bytes.toString("utf8");
}
