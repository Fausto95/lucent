// TextEncoder and TextDecoder, by the Encoding standard (T105).
import { utf8Decode } from "lucent:core";

/** A string's code units, in hex: what U+FFFD and lone surrogates are, readably. */
function units(s: string): string {
  const out: string[] = [];
  for (let i = 0; i < s.length; i++) out.push(s.charCodeAt(i).toString(16));
  return out.join(" ");
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(" ");
}

export function encoded(): string {
  const encoder = new TextEncoder();
  const lines = [
    encoder.encoding,
    hex(encoder.encode("abc")),
    hex(encoder.encode("é€")),
    hex(encoder.encode("\u{1F600}")),
    // Lone surrogates are U+FFFD.
    hex(encoder.encode("a\uD800b\uDC00")),
    `${encoder.encode().length} ${encoder.encode(undefined).length}`,
    String(encoder),
  ];
  return lines.join("\n");
}

export function encodedInto(sizes: number[]): string {
  const encoder = new TextEncoder();
  const lines: string[] = [];
  for (const size of sizes) {
    const into = new Uint8Array(size);
    const { read, written } = encoder.encodeInto("aé\u{1F600}€\uD800", into);
    lines.push(`${size}: read ${read}, wrote ${written}: ${hex(into)}`);
  }
  // From the start of the array, and of a view into another.
  const whole = new Uint8Array(6).fill(0xff);
  const result = encoder.encodeInto("xy", whole.subarray(2));
  lines.push(`${result.read} ${result.written} ${hex(whole)}`);
  return lines.join("\n");
}

export function decoded(bytes: number[]): string {
  const input = new Uint8Array(bytes);
  const decoder = new TextDecoder();
  return `${units(decoder.decode(input))} | ${units(utf8Decode(input))}`;
}

export function boms(): string {
  const bom = new Uint8Array([0xef, 0xbb, 0xbf, 0x41, 0xef, 0xbb, 0xbf]);
  const kept = new TextDecoder("utf-8", { ignoreBOM: true });
  const dropped = new TextDecoder();
  // Once per stream: the first call after a whole decode starts another.
  return [
    units(dropped.decode(bom)),
    units(dropped.decode(bom)),
    units(kept.decode(bom)),
    `${dropped.ignoreBOM} ${kept.ignoreBOM}`,
  ].join("\n");
}

export function streamed(chunks: number[][]): string {
  const decoder = new TextDecoder();
  let text = "";
  for (const chunk of chunks) text += `[${units(decoder.decode(new Uint8Array(chunk), { stream: true }))}]`;
  // The end of the stream: what it held is an error.
  text += `[${units(decoder.decode())}]`;
  return text;
}

export function fatal(bytes: number[], stream: boolean): string {
  const decoder = new TextDecoder("utf8", { fatal: true });
  try {
    const first = decoder.decode(new Uint8Array(bytes), { stream });
    return `decoded ${units(first)}, then ${units(decoder.decode())} (fatal ${decoder.fatal})`;
  } catch (e) {
    if (e instanceof TypeError) return `TypeError: ${e.message}`;
    throw e;
  }
}

export function views(): string {
  const decoder = new TextDecoder();
  const bytes = new TextEncoder().encode("héllo wörld");
  const buffer = bytes.buffer;
  return [
    decoder.decode(buffer),
    decoder.decode(new DataView(buffer, 1, 5)),
    decoder.decode(bytes.subarray(7)),
    units(decoder.decode(new Uint16Array([0x6968, 0x2121]))),
    decoder.decode(undefined),
  ].join("\n");
}

export function labels(label: string): string {
  try {
    const decoder = new TextDecoder(label);
    return `${decoder.encoding} ${decoder.fatal}`;
  } catch (e) {
    if (e instanceof RangeError) return `RangeError: ${e.message}`;
    throw e;
  }
}

export function options(fatalToo: boolean): string {
  const decoder = new TextDecoder(" UTF-8\n", { fatal: fatalToo, ignoreBOM: !fatalToo });
  return `${decoder.encoding} ${decoder.fatal} ${decoder.ignoreBOM} ${String(decoder)}`;
}
