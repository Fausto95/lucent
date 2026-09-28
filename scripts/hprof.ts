/**
 * Counts objects in a heap dump (the standard HPROF format, as
 * `hprof-conv` writes an Android dump): for each class whose name a
 * pattern matches, its live instances and how many of them JNI global
 * references hold (native code keeps those alive). The views spike
 * (scripts/views-spike.ts --heap) uses it to show what a mount leaves
 * behind once it ends.
 */
import fs from "node:fs";

export interface ClassCount {
  readonly name: string;
  readonly instances: number;
  /** Instances a JNI global reference holds. */
  readonly jniGlobal: number;
}

/** Top-level record tags. */
const STRING = 0x01;
const LOAD_CLASS = 0x02;
const HEAP_DUMP = 0x0c;
const HEAP_DUMP_SEGMENT = 0x1c;

/** Sizes of a basic type's value, by type code; 2 is an object id. */
const TYPE_SIZES: Record<number, number | "id"> = {
  2: "id",
  4: 1,
  5: 2,
  6: 4,
  7: 8,
  8: 1,
  9: 2,
  10: 4,
  11: 8,
};

/** What a heap dump's sub-record holds after its tag, for the ones with a fixed layout. */
const FIXED_SUBRECORDS: Record<number, ("id" | 1 | 2 | 4)[]> = {
  0xff: ["id"], // root unknown
  0x01: ["id", "id"], // root JNI global: the object, the reference
  0x02: ["id", 4, 4], // root JNI local
  0x03: ["id", 4, 4], // root Java frame
  0x04: ["id", 4], // root native stack
  0x05: ["id"], // root sticky class
  0x06: ["id", 4], // root thread block
  0x07: ["id"], // root monitor used
  0x08: ["id", 4, 4], // root thread object
};

const ROOT_JNI_GLOBAL = 0x01;
const CLASS_DUMP = 0x20;
const INSTANCE_DUMP = 0x21;
const OBJECT_ARRAY_DUMP = 0x22;
const PRIMITIVE_ARRAY_DUMP = 0x23;

/** Counts the instances of the classes `patterns` match in the heap dump `file`. */
export function countClasses(file: string, patterns: readonly RegExp[]): ClassCount[] {
  const b = fs.readFileSync(file);
  const header = b.indexOf(0);
  const idSize = b.readUInt32BE(header + 1);
  const id = (at: number) =>
    idSize === 8 ? b.readBigUInt64BE(at).toString() : b.readUInt32BE(at).toString();
  const size = (s: "id" | number) => (s === "id" ? idSize : s);

  const strings = new Map<string, string>();
  const classNames = new Map<string, string>();
  const instances = new Map<string, string[]>();
  const globals = new Set<string>();

  let at = header + 1 + 4 + 8;

  while (at < b.length) {
    const tag = b[at]!;
    const length = b.readUInt32BE(at + 5);
    const body = at + 9;
    const end = body + length;

    if (tag === STRING) strings.set(id(body), b.toString("utf8", body + idSize, end));
    else if (tag === LOAD_CLASS) classNames.set(id(body + 4), id(body + 8 + idSize));
    else if (tag === HEAP_DUMP || tag === HEAP_DUMP_SEGMENT) {
      let p = body;

      while (p < end) {
        const sub = b[p++]!;
        const fixed = FIXED_SUBRECORDS[sub];

        if (fixed) {
          if (sub === ROOT_JNI_GLOBAL) globals.add(id(p));

          p += fixed.reduce<number>((n, s) => n + size(s), 0);
        } else if (sub === CLASS_DUMP) {
          p += idSize * 7 + 8;

          const constants = b.readUInt16BE(p);
          p += 2;
          for (let i = 0; i < constants; i++) p += 3 + size(TYPE_SIZES[b[p + 2]!]!);

          const statics = b.readUInt16BE(p);
          p += 2;
          for (let i = 0; i < statics; i++) p += idSize + 1 + size(TYPE_SIZES[b[p + idSize]!]!);

          p += 2 + b.readUInt16BE(p) * (idSize + 1);
        } else if (sub === INSTANCE_DUMP) {
          const object = id(p);
          const cls = id(p + idSize + 4);
          const fields = b.readUInt32BE(p + idSize * 2 + 4);
          const list = instances.get(cls);

          if (list) list.push(object);
          else instances.set(cls, [object]);

          p += idSize * 2 + 8 + fields;
        } else if (sub === OBJECT_ARRAY_DUMP) {
          p += idSize + 8 + b.readUInt32BE(p + idSize + 4) * idSize + idSize;
        } else if (sub === PRIMITIVE_ARRAY_DUMP) {
          const n = b.readUInt32BE(p + idSize + 4);

          p += idSize + 9 + n * size(TYPE_SIZES[b[p + idSize + 8]!]!);
        } else {
          throw new Error(`${file}: unknown heap dump sub-record 0x${sub.toString(16)}`);
        }
      }
    }

    at = end;
  }

  const counts: ClassCount[] = [];

  for (const [cls, nameId] of classNames) {
    const name = (strings.get(nameId) ?? "?").replaceAll("/", ".");

    if (!patterns.some((p) => p.test(name))) continue;

    const objects = instances.get(cls) ?? [];

    counts.push({
      name,
      instances: objects.length,
      jniGlobal: objects.filter((o) => globals.has(o)).length,
    });
  }

  return counts.sort((x, y) => x.name.localeCompare(y.name));
}
