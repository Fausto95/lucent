/**
 * A JVM class file reader (JVMS §4), limited to what bindings need: names,
 * access flags, descriptors, generic signatures, constant values,
 * annotations (for nullability) and inner-class records.
 */
import { ConstantPool } from "./constant-pool.ts";

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
  /** A `static final` field's ConstantValue: a long's as a bigint, exactly. */
  constant?: number | bigint | string;
  deprecated: boolean;
  /** Annotation type descriptors (`Landroid/annotation/NonNull;`), visible and invisible. */
  annotations: string[];
  /** The string and enum elements of those annotations, by descriptor then element (an enum's as its constant's name). */
  annotationValues: AnnotationValues;
  /** Per parameter, for methods. */
  paramAnnotations: string[][];
}

/** `Lkotlin/Deprecated;` → `level` → `ERROR`: annotations' string and enum elements. */
export type AnnotationValues = Record<string, Record<string, string>>;

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
  annotationValues: AnnotationValues;
  fields: MemberInfo[];
  methods: MemberInfo[];
  innerClasses: InnerClass[];
}

export function parseClass(buf: Buffer): ClassFile {
  const pool = new ConstantPool(buf);
  let p = pool.end;
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
  const utf8 = (i: number) => pool.utf8(i);
  const className = (i: number) => pool.className(i);
  const constant = (i: number) => pool.value(i);

  /** An element value: a string's or an enum constant's name; undefined for any other. */
  const elementValue = (): string | undefined => {
    const tag = String.fromCharCode(u1());
    if (tag === "s") return utf8(u2());
    if ("BCDFIJSZc".includes(tag)) p += 2;
    else if (tag === "e") {
      p += 2;
      return utf8(u2());
    } else if (tag === "@") annotation(new Map());
    else if (tag === "[") {
      const n = u2();
      for (let k = 0; k < n; k++) elementValue();
    } else throw new Error(`class file: element value tag ${tag}`);
    return undefined;
  };
  const annotation = (values: Map<string, Record<string, string>>): string => {
    const type = utf8(u2());
    const elements: Record<string, string> = {};
    const pairs = u2();
    for (let k = 0; k < pairs; k++) {
      const name = utf8(u2());
      const value = elementValue();
      if (value !== undefined) elements[name] = value;
    }
    if (Object.keys(elements).length) values.set(type, elements);
    return type;
  };
  const annotations = (values: Map<string, Record<string, string>>): string[] => {
    const n = u2();
    const out: string[] = [];
    for (let k = 0; k < n; k++) out.push(annotation(values));
    return out;
  };

  interface Attrs {
    signature?: string;
    constant?: number | bigint | string;
    deprecated: boolean;
    annotations: string[];
    annotationValues: AnnotationValues;
    paramAnnotations: string[][];
    innerClasses: InnerClass[];
  }
  const attributes = (): Attrs => {
    const values = new Map<string, Record<string, string>>();
    const out: Attrs = {
      deprecated: false,
      annotations: [],
      annotationValues: {},
      paramAnnotations: [],
      innerClasses: [],
    };
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
          out.annotations.push(...annotations(values));
          break;
        case "RuntimeVisibleParameterAnnotations":
        case "RuntimeInvisibleParameterAnnotations": {
          const params = u1();
          for (let q = 0; q < params; q++) {
            out.paramAnnotations[q] = [
              ...(out.paramAnnotations[q] ?? []),
              ...annotations(new Map()),
            ];
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
            out.innerClasses.push({
              inner: className(inner),
              outer: outer ? className(outer) : undefined,
              simpleName: simple ? utf8(simple) : undefined,
              access,
            });
          }
          break;
        }
      }
      p = end;
    }
    out.annotationValues = Object.fromEntries(values);
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
      out.push({
        name: memberName,
        descriptor,
        access: acc,
        signature: a.signature,
        constant: a.constant,
        deprecated: a.deprecated,
        annotations: a.annotations,
        annotationValues: a.annotationValues,
        paramAnnotations: a.paramAnnotations,
      });
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
    annotationValues: a.annotationValues,
    fields,
    methods,
    innerClasses: a.innerClasses,
  };
}
