import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { compile } from "../src/index.ts";

/** Compiles one module `m`; the result and each file's text, whitespace collapsed. */
function build(source: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-buffers-"));
  const file = path.join(dir, "m.lucent.ts");

  fs.writeFileSync(file, source);

  const r = compile([file]);
  const text = (name: string) => (r.files.get(name) ?? "").replace(/\s+/g, " ");

  return { r, text };
}

/** The diagnostics of module `m`, as code, message and line. */
function refusals(source: string) {
  return build(source).r.diagnostics.map((d) => ({
    code: d.code,
    message: d.message,
    line: d.line,
  }));
}

const IMPORTS = `import { compute, delay, NativeBuffer, type ByteSpan, type MutableByteSpan } from "lucent:core";\n`;

const SAMPLE = `${IMPORTS}
function scan(buffer: NativeBuffer): number {
  using owned = buffer;

  return owned.withRead((bytes) => {
    let total = 0;
    for (let i = 0; i < bytes.length; i++) total += bytes[i]!;
    return total;
  });
}

function fill(bytes: MutableByteSpan): void {
  bytes.fill(7);
}

export async function sample(): Promise<number> {
  const buffer = NativeBuffer.allocate(4096);
  buffer.withWrite(fill);
  return await compute(scan, buffer.transfer());
}

export function make(bytes: Uint8Array): NativeBuffer {
  return NativeBuffer.from(bytes);
}

export function first(buffer: NativeBuffer): number | undefined {
  return buffer.withRead((bytes: ByteSpan) => bytes[0]);
}
`;

describe("buffer lowering", () => {
  it("lends spans to borrows and moves buffers to tasks", () => {
    const { r, text } = build(SAMPLE);

    expect(r.diagnostics).toEqual([]);

    const unit = text("m_m.cpp");

    expect(unit).toContain("lucent::NativeBufferObject::allocate(");
    expect(unit).toContain("lucent::NativeBufferObject::fromBytes(");
    expect(unit).toContain("lucent::withRead(");
    expect(unit).toContain("lucent::withWrite(");
    expect(unit).toContain("lucent::ByteSpan");
    expect(unit).toContain("->transfer()");
    expect(unit).toMatch(/lucent::TaskEntry<std::tuple<lucent::NativeBuffer>, double>/);
  });

  it("hands buffers to JavaScript as handles", () => {
    const { r } = build(SAMPLE);
    const bindings = [...r.files].find(([name]) => name.includes("bindings"))?.[1] ?? "";

    expect(bindings).toContain("Convert<lucent::NativeBuffer>");
  });
});

describe("borrows", () => {
  const borrow = (body: string, extra = "") =>
    refusals(`${IMPORTS}${extra}
export function f(buffer: NativeBuffer): number {
${body}
  return 0;
}
`);

  it("refuses a span its callback returns", () => {
    const [d] = borrow("  const kept = buffer.withRead((bytes) => bytes);\n  void kept;");

    expect(d).toMatchObject({ code: "LUCENT3030" });
    expect(d!.message).toContain("`bytes`");
    expect(d!.message).toContain("returned");
  });

  it("refuses a span stored where it outlives the borrow", () => {
    expect(
      borrow(
        "  buffer.withRead((bytes) => {\n    kept.push(bytes);\n  });",
        "const kept: ByteSpan[] = [];\n",
      ),
    ).toMatchObject([{ code: "LUCENT3030" }]);
    expect(
      borrow(
        "  let later: ByteSpan | undefined;\n  buffer.withRead((bytes) => {\n    later = bytes;\n  });\n  void later;",
      ),
    ).toMatchObject([{ code: "LUCENT3030" }]);
  });

  it("refuses a span captured by a closure that outlives the borrow", () => {
    expect(
      borrow(
        "  let size: (() => number) | undefined;\n  buffer.withRead((bytes) => {\n    size = () => bytes.length;\n  });\n  void size;",
      ),
    ).toMatchObject([{ code: "LUCENT3030" }]);
  });

  it("refuses a span passed to code that keeps it", () => {
    expect(
      borrow(
        "  buffer.withRead((bytes) => keep(bytes));",
        "const kept: ByteSpan[] = [];\nfunction keep(bytes: ByteSpan): void {\n  kept.push(bytes);\n}\n",
      ),
    ).toMatchObject([{ code: "LUCENT3030" }]);
  });

  it("refuses a named callback that keeps its span", () => {
    expect(
      borrow(
        "  buffer.withRead(keep);",
        "const kept: ByteSpan[] = [];\nfunction keep(bytes: ByteSpan): void {\n  kept.push(bytes);\n}\n",
      ),
    ).toMatchObject([{ code: "LUCENT3030" }]);
  });

  it("refuses a callback that would hold its span across await", () => {
    const [d] = borrow("  void buffer.withRead(async (bytes) => bytes.length);");

    expect(d).toMatchObject({ code: "LUCENT3030" });
    expect(d!.message).toContain("await");
  });

  it("refuses a span a nested closure holds across await or past a promise", () => {
    const [awaited] = borrow(
      "  buffer.withRead((bytes) => {\n    void (async () => {\n      await delay(1);\n      return bytes[0];\n    })();\n  });",
    );
    const [later] = borrow(
      "  void buffer.withRead((bytes) => Promise.resolve(1).then(() => bytes.length));",
    );

    expect(awaited).toMatchObject({ code: "LUCENT3030" });
    expect(awaited!.message).toContain("after `await`");
    expect(later).toMatchObject({ code: "LUCENT3030" });
    expect(later!.message).toContain("runs it later");
  });

  it("refuses a callback it cannot see", () => {
    expect(
      borrow("  const read = (bytes: ByteSpan) => bytes.length;\n  buffer.withRead(read);"),
    ).toMatchObject([{ code: "LUCENT1007" }]);
  });

  it("accepts reads, helpers that only read, and closures called during the borrow", () => {
    expect(
      borrow(
        `  const sum = buffer.withRead((bytes) => {
    let total = count(bytes);
    [1, 2].forEach((i) => {
      total += bytes[i] ?? 0;
    });
    return total;
  });
  buffer.withWrite((bytes) => {
    bytes[0] = sum;
    bytes.set(new Uint8Array([1]), 1);
  });`,
        "function count(bytes: ByteSpan): number {\n  return bytes.length;\n}\n",
      ),
    ).toEqual([]);
  });

  it("keeps spans away from JavaScript and compute tasks", () => {
    expect(
      refusals(
        `${IMPORTS}export function size(bytes: ByteSpan): number {\n  return bytes.length;\n}\n`,
      ),
    ).toMatchObject([{ code: "LUCENT2006" }]);

    const [d] = borrow(
      "  buffer.withRead((bytes) => {\n    void compute(size, bytes);\n  });",
      "function size(bytes: ByteSpan): number {\n  return bytes.length;\n}\n",
    );

    expect(d).toMatchObject({ code: "LUCENT3012" });
    expect(d!.message).toContain("borrow");
  });
});

describe("typed borrows", () => {
  const TYPED = `import { NativeBuffer, type TypedSpan, type MutableTypedSpan } from "lucent:core";\n`;

  it("lends a span of the typed array's elements, a Uint8Array's being withRead's", () => {
    const { r, text } = build(`${TYPED}
function peak(samples: TypedSpan<Float32Array>): number {
  let top = 0;
  for (let i = 0; i < samples.length; i++) top = Math.max(top, samples[i]!);
  return top;
}

function clear(words: MutableTypedSpan<BigInt64Array>): void {
  words.fill(0n);
}

export function f(buffer: NativeBuffer): number {
  buffer.withWriteAs(BigInt64Array, clear);
  return buffer.withReadAs(Float32Array, peak) + buffer.withReadAs(Uint8Array, (b) => b.length);
}
`);

    expect(r.diagnostics).toEqual([]);

    const unit = text("m_m.cpp");

    expect(unit).toContain("lucent::withReadAs<lucent::typed::Float32>(");
    expect(unit).toContain("lucent::withWriteAs<lucent::typed::BigInt64>(");
    expect(unit).toContain("lucent::TypedSpan<lucent::typed::Float32>");
    expect(unit).toContain("lucent::MutableTypedSpan<lucent::typed::BigInt64>");
    expect(unit).toContain("lucent::withRead(");
  });

  it("refuses a span kept past its borrow", () => {
    const [d, ...rest] = refusals(`${TYPED}
const kept: TypedSpan<Int16Array>[] = [];

export function f(buffer: NativeBuffer): void {
  buffer.withReadAs(Int16Array, (words) => {
    kept.push(words);
  });
}
`);

    expect(rest).toEqual([]);
    expect(d).toMatchObject({ code: "LUCENT3030" });
    expect(d!.message).toContain("withReadAs lends the bytes only while its callback runs");
  });
});

describe("moves", () => {
  const moves = (body: string) =>
    refusals(`${IMPORTS}
function scan(buffer: NativeBuffer): number {
  return buffer.byteLength;
}

function scaled(job: { buffer: NativeBuffer; scale: number }): number {
  return job.buffer.byteLength * job.scale;
}

export async function f(buffer: NativeBuffer, flag: boolean): Promise<number> {
${body}
}
`);

  it("refuses a buffer used after transfer()", () => {
    const [d] = moves(
      "  const moved = buffer.transfer();\n  return buffer.byteLength + moved.byteLength;",
    );

    expect(d).toMatchObject({ code: "LUCENT3031", line: 13 });
    expect(d!.message).toContain("`buffer`");
    expect(d!.message).toContain("transfer()");
  });

  it("refuses a buffer used after transferToArrayBuffer()", () => {
    const [d] = moves(
      "  const bytes = buffer.transferToArrayBuffer();\n  return buffer.byteLength + bytes.byteLength;",
    );

    expect(d).toMatchObject({ code: "LUCENT3031", line: 13 });
    expect(d!.message).toContain("transferToArrayBuffer()");
  });

  it("refuses a buffer used after it moved to a compute task", () => {
    expect(
      moves("  const sum = await compute(scan, buffer);\n  return sum + scan(buffer);"),
    ).toMatchObject([{ code: "LUCENT3031", line: 13 }]);
    expect(
      moves(
        "  const sum = await compute(scaled, { buffer, scale: 2 });\n  return sum + buffer.byteLength;",
      ),
    ).toMatchObject([{ code: "LUCENT3031", line: 13 }]);
  });

  it("allows what a moved buffer still does, and what may not have moved", () => {
    expect(moves("  buffer.transfer();\n  buffer.close();\n  return 0;")).toEqual([]);
    expect(moves("  if (flag) buffer.transfer();\n  return buffer.byteLength;")).toEqual([]);
    expect(
      moves("  const later = () => buffer.transfer();\n  void later;\n  return buffer.byteLength;"),
    ).toEqual([]);
    expect(
      moves(
        "  let b = buffer;\n  b.transfer();\n  b = NativeBuffer.allocate(1);\n  return b.byteLength;",
      ),
    ).toEqual([]);
  });
});
