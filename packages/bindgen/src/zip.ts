import fs from "node:fs";
import zlib from "node:zlib";

/**
 * A minimal reader for zip archives (jar, aar): the central directory, and
 * entries stored or deflated. No zip64, no encryption; class archives need
 * neither.
 */
export class ZipArchive {
  private readonly buf: Buffer;
  private readonly entries = new Map<string, { method: number; size: number; offset: number }>();

  constructor(file: string | Buffer) {
    this.buf = typeof file === "string" ? fs.readFileSync(file) : file;
    const eocd = this.findEndOfCentralDirectory();
    const count = this.buf.readUInt16LE(eocd + 10);
    let p = this.buf.readUInt32LE(eocd + 16);
    for (let i = 0; i < count; i++) {
      if (this.buf.readUInt32LE(p) !== 0x02014b50)
        throw new Error("zip: corrupt central directory");
      const method = this.buf.readUInt16LE(p + 10);
      const size = this.buf.readUInt32LE(p + 20);
      const nameLen = this.buf.readUInt16LE(p + 28);
      const extraLen = this.buf.readUInt16LE(p + 30);
      const commentLen = this.buf.readUInt16LE(p + 32);
      const offset = this.buf.readUInt32LE(p + 42);
      const name = this.buf.toString("utf8", p + 46, p + 46 + nameLen);
      this.entries.set(name, { method, size, offset });
      p += 46 + nameLen + extraLen + commentLen;
    }
  }

  names(): string[] {
    return [...this.entries.keys()];
  }

  read(name: string): Buffer | undefined {
    const e = this.entries.get(name);
    if (!e) return undefined;
    if (this.buf.readUInt32LE(e.offset) !== 0x04034b50)
      throw new Error(`zip: corrupt entry ${name}`);
    const start =
      e.offset + 30 + this.buf.readUInt16LE(e.offset + 26) + this.buf.readUInt16LE(e.offset + 28);
    const data = this.buf.subarray(start, start + e.size);
    if (e.method === 0) return data;
    if (e.method === 8) return zlib.inflateRawSync(data);
    throw new Error(`zip: unsupported compression ${e.method} for ${name}`);
  }

  private findEndOfCentralDirectory(): number {
    for (let p = this.buf.length - 22; p >= Math.max(0, this.buf.length - 22 - 0xffff); p--) {
      if (this.buf.readUInt32LE(p) === 0x06054b50) return p;
    }
    throw new Error("zip: no central directory");
  }
}
