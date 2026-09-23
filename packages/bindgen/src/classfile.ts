/**
 * A JVM class file reader (JVMS §4), limited to what bindings need: names,
 * access flags, descriptors, generic signatures, constant values,
 * annotations (for nullability) and inner-class records.
 */

export const ACC = {
  PUBLIC: 0x0001,
  PRIVATE: 0x0002,
  PROTECTED: 0x0004,
  STATIC: 0x0008,
  FINAL: 0x0010,
  SYNTHETIC: 0x1000,
  BRIDGE: 0x0040,
  INTERFACE: 0x0200,
  ABSTRACT: 0x0400,
  ANNOTATION: 0x2000,
  ENUM: 0x4000,
} as const;

export interface MemberInfo {
  name: string;
  descriptor: string;
  access: number;
  signature?: string;
  constant?: number | string;
  deprecated: boolean;
  /** Annotation type descriptors (`Landroid/annotation/NonNull;`), visible and invisible. */
  annotations: string[];
  /** Per parameter, for methods. */
  paramAnnotations: string[][];
}

export interface InnerClass {
  inner: string;
  outer?: string;
  simpleName?: string;
  access: number;
}

export interface ClassFile {
  /** Internal name: `android/os/Build$VERSION`. */
  name: string;
  access: number;
  superName?: string;
  interfaces: string[];
  signature?: string;
  deprecated: boolean;
  annotations: string[];
  fields: MemberInfo[];
  methods: MemberInfo[];
  innerClasses: InnerClass[];
}

type Constant = { tag: number; a?: number; b?: number; value?: string | number | bigint };

export function parseClass(buf: Buffer): ClassFile {
  let p = 0;
  const u1 = () => buf.readUInt8(p++);
  const u2 = () => {
    const v = buf.readUInt16BE(p);
    p += 2;
    return v;
  };
  const u4 = () => {
    const v = buf.readUInt32BE(p);
    p += 4;
    return v;
  };
  if (u4() !== 0xcafebabe) throw new Error("not a class file");
  p += 4; // minor, major

  const count = u2();
  const cp: Constant[] = new Array(count);
  for (let i = 1; i < count; i++) {
    const tag = u1();
    switch (tag) {
      case 1: {
        const len = u2();
        cp[i] = { tag, value: buf.toString("utf8", p, p + len) };
        p += len;
        break;
      }
      case 3:
        cp[i] = { tag, value: buf.readInt32BE(p) };
        p += 4;
        break;
      case 4:
        cp[i] = { tag, value: buf.readFloatBE(p) };
        p += 4;
        break;
      case 5:
        cp[i] = { tag, value: buf.readBigInt64BE(p) };
        p += 8;
        i++; // longs take two entries
        break;
      case 6:
        cp[i] = { tag, value: buf.readDoubleBE(p) };
        p += 8;
        i++;
        break;
      case 7:
      case 8:
      case 16:
      case 19:
      case 20:
        cp[i] = { tag, a: u2() };
        break;
      case 9:
      case 10:
      case 11:
      case 12:
      case 17:
      case 18:
        cp[i] = { tag, a: u2(), b: u2() };
        break;
      case 15:
        cp[i] = { tag, a: u1(), b: u2() };
        break;
      default:
        throw new Error(`class file: unknown constant tag ${tag}`);
    }
  }
  const utf8 = (i: number) => cp[i]!.value as string;
  const className = (i: number) => utf8(cp[i]!.a!);
  const constant = (i: number): number | string => {
    const c = cp[i]!;
    if (c.tag === 8) return utf8(c.a!);
    if (typeof c.value === "bigint") return Number(c.value);
    return c.value as number;
  };

  const skipElementValue = (): void => {
    const tag = String.fromCharCode(u1());
    if ("BCDFIJSZsc".includes(tag)) p += 2;
    else if (tag === "e") p += 4;
    else if (tag === "@") skipAnnotation();
    else if (tag === "[") {
      const n = u2();
      for (let k = 0; k < n; k++) skipElementValue();
    } else throw new Error(`class file: element value tag ${tag}`);
  };
  const annotation = (): string => {
    const type = utf8(u2());
    const pairs = u2();
    for (let k = 0; k < pairs; k++) {
      p += 2;
      skipElementValue();
    }
    return type;
  };
  function skipAnnotation(): void {
    annotation();
  }
  const annotations = (): string[] => {
    const n = u2();
    const out: string[] = [];
    for (let k = 0; k < n; k++) out.push(annotation());
    return out;
  };

  interface Attrs {
    signature?: string;
    constant?: number | string;
    deprecated: boolean;
    annotations: string[];
    paramAnnotations: string[][];
    innerClasses: InnerClass[];
  }
  const attributes = (): Attrs => {
    const out: Attrs = { deprecated: false, annotations: [], paramAnnotations: [], innerClasses: [] };
    const n = u2();
    for (let k = 0; k < n; k++) {
      const name = utf8(u2());
      const len = u4();
      const end = p + len;
      switch (name) {
        case "Signature":
          out.signature = utf8(u2());
          break;
        case "ConstantValue":
          out.constant = constant(u2());
          break;
        case "Deprecated":
          out.deprecated = true;
          break;
        case "RuntimeVisibleAnnotations":
        case "RuntimeInvisibleAnnotations":
          out.annotations.push(...annotations());
          break;
        case "RuntimeVisibleParameterAnnotations":
        case "RuntimeInvisibleParameterAnnotations": {
          const params = u1();
          for (let q = 0; q < params; q++) {
            out.paramAnnotations[q] = [...(out.paramAnnotations[q] ?? []), ...annotations()];
          }
          break;
        }
        case "InnerClasses": {
          const m = u2();
          for (let q = 0; q < m; q++) {
            const inner = u2();
            const outer = u2();
            const simple = u2();
            const access = u2();
            out.innerClasses.push({ inner: className(inner), outer: outer ? className(outer) : undefined, simpleName: simple ? utf8(simple) : undefined, access });
          }
          break;
        }
      }
      p = end;
    }
    return out;
  };

  const access = u2();
  const name = className(u2());
  const superIndex = u2();
  const interfaces: string[] = [];
  for (let n = u2(), k = 0; k < n; k++) interfaces.push(className(u2()));
  const members = (): MemberInfo[] => {
    const out: MemberInfo[] = [];
    for (let n = u2(), k = 0; k < n; k++) {
      const acc = u2();
      const memberName = utf8(u2());
      const descriptor = utf8(u2());
      const a = attributes();
      out.push({ name: memberName, descriptor, access: acc, signature: a.signature, constant: a.constant, deprecated: a.deprecated, annotations: a.annotations, paramAnnotations: a.paramAnnotations });
    }
    return out;
  };
  const fields = members();
  const methods = members();
  const a = attributes();
  return {
    name,
    access,
    superName: superIndex ? className(superIndex) : undefined,
    interfaces,
    signature: a.signature,
    deprecated: a.deprecated,
    annotations: a.annotations,
    fields,
    methods,
    innerClasses: a.innerClasses,
  };
}
