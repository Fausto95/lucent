/**
 * A class file's constant pool (JVMS §4.4), read once by both class
 * readers (classfile.ts, kotlin-metadata-reader.ts): where each entry is,
 * its tag, and its strings decoded on first use, as modified UTF-8.
 */
export class ConstantPool {
  readonly tags: Uint8Array;
  /** Each entry's position, after its tag. */
  readonly offsets: Int32Array;
  /** Where the class file goes on after the pool (its access flags). */
  readonly end: number;
  private readonly strings: (string | undefined)[];
  private readonly buf: Buffer;

  constructor(buf: Buffer) {
    this.buf = buf;
    if (buf.readUInt32BE(0) !== 0xcafebabe) throw new Error("not a class file");

    let p = 8; // magic, minor, major
    const count = buf.readUInt16BE(p);
    p += 2;
    this.tags = new Uint8Array(count);
    this.offsets = new Int32Array(count);
    this.strings = new Array(count);

    for (let i = 1; i < count; i++) {
      const tag = buf[p++]!;
      this.tags[i] = tag;
      this.offsets[i] = p;

      if (tag === 1) p += 2 + buf.readUInt16BE(p);
      else if (tag === 5 || tag === 6) {
        p += 8;
        i++; // longs and doubles take two entries
      } else if (tag === 3 || tag === 4 || (tag >= 9 && tag <= 12) || tag === 17 || tag === 18)
        p += 4;
      else if (tag === 7 || tag === 8 || tag === 16 || tag === 19 || tag === 20) p += 2;
      else if (tag === 15) p += 3;
      else throw new Error(`class file: unknown constant tag ${tag}`);
    }
    this.end = p;
  }

  /** A CONSTANT_Utf8 entry's string. */
  utf8(i: number): string {
    if (this.tags[i] !== 1) throw new Error(`class file: constant ${i} is not a string`);
    let s = this.strings[i];
    if (s === undefined) {
      const at = this.offsets[i]!;
      s = modifiedUtf8(this.buf, at + 2, at + 2 + this.buf.readUInt16BE(at));
      this.strings[i] = s;
    }
    return s;
  }

  /** The first u2 of an entry: a Class's or String's name, a member reference's class. */
  index(i: number): number {
    return this.buf.readUInt16BE(this.offsets[i]!);
  }

  /** A CONSTANT_Class's internal name. */
  className(i: number): string {
    return this.utf8(this.index(i));
  }

  /** A ConstantValue's value: an int, float, long (as a bigint, exactly), double or string. */
  value(i: number): number | bigint | string {
    const at = this.offsets[i]!;
    switch (this.tags[i]) {
      case 3:
        return this.buf.readInt32BE(at);
      case 4:
        return this.buf.readFloatBE(at);
      case 5:
        return this.buf.readBigInt64BE(at);
      case 6:
        return this.buf.readDoubleBE(at);
      case 8:
        return this.utf8(this.index(i));
      default:
        throw new Error(`class file: constant ${i} is not a value`);
    }
  }

  /** A CONSTANT_Integer's value. */
  int(i: number): number {
    if (this.tags[i] !== 3) throw new Error(`class file: constant ${i} is not an int`);
    return this.buf.readInt32BE(this.offsets[i]!);
  }
}

/**
 * Decodes a class file string (JVMS §4.4.7): modified UTF-8, which writes
 * NUL as the two bytes C0 80 and a character outside the BMP as its two
 * surrogates, three bytes each (as CESU-8 does). Node's UTF-8 decoder
 * reads neither.
 */
export function modifiedUtf8(buf: Buffer, start: number, end: number): string {
  let ascii = true;
  for (let i = start; i < end; i++) {
    if (buf[i]! >= 0x80) {
      ascii = false;
      break;
    }
  }
  if (ascii) return buf.toString("latin1", start, end);

  const codes: number[] = [];
  for (let i = start; i < end;) {
    const b = buf[i++]!;

    if (b < 0x80) codes.push(b);
    else if ((b & 0xe0) === 0xc0) codes.push(((b & 0x1f) << 6) | (buf[i++]! & 0x3f));
    else {
      codes.push(((b & 0x0f) << 12) | ((buf[i]! & 0x3f) << 6) | (buf[i + 1]! & 0x3f));
      i += 2;
    }
  }

  let out = "";
  for (let i = 0; i < codes.length; i += 8192)
    out += String.fromCharCode(...codes.slice(i, i + 8192));
  return out;
}
