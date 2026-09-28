/**
 * Decodes the protobuf messages of Kotlin JVM metadata (`@Metadata(d1, d2)`)
 * into the normalized declarations of kotlin-metadata.ts, the way the official
 * kotlin-metadata-jvm library reads them (its `Readers.kt` and
 * `JvmMetadataExtensions.kt`), for the facts that contract needs.
 *
 * Field numbers come from the generated `org.jetbrains.kotlin.metadata.ProtoBuf`
 * and `.jvm.JvmProtoBuf` sources in kotlin-metadata-jvm-sources.jar (2.4.20),
 * flag bit layouts from `deserialization/Flags.java`, the string table from
 * `JvmNameResolverBase.kt`, `d1` from `BitEncoding.java`, and default JVM
 * descriptors from `ClassMapperLite.kt`. Not decoded: annotations stored in
 * metadata other than types', annotation arguments, contracts, version
 * requirements, type aliases and abbreviated types, compiler plugin data.
 */

import type {
  JvmSignature,
  KotlinAccessor,
  KotlinClass,
  KotlinClassKind,
  KotlinConstructor,
  KotlinFunction,
  KotlinMemberKind,
  KotlinModality,
  KotlinProperty,
  KotlinType,
  KotlinTypeParameter,
  KotlinValueParameter,
  KotlinVariance,
  KotlinVisibility,
} from "./kotlin-metadata.ts";

/* --- Protobuf wire format ------------------------------------------------ */

/** A parsed message: each field's values in order, varints as int32, length-delimited fields as byte views. */
type Fields = Map<number, (number | Uint8Array)[]>;

/** Reads the varint at `p`, as int32 (the low 32 bits), and where the next value starts. */
function varint(bytes: Uint8Array, p: number): [value: number, next: number] {
  let result = 0;

  for (let shift = 0; ; shift += 7) {
    if (p >= bytes.length) throw new Error("Kotlin metadata: truncated protobuf");

    const b = bytes[p++]!;
    if (shift < 32) result |= (b & 0x7f) << shift;
    if (b < 0x80) return [result, p];
  }
}

function parse(bytes: Uint8Array): Fields {
  const fields: Fields = new Map();
  let p = 0;

  while (p < bytes.length) {
    const [key, afterKey] = varint(bytes, p);
    const field = key >>> 3;
    let value: number | Uint8Array;
    p = afterKey;

    switch (key & 7) {
      case 0:
        [value, p] = varint(bytes, p);
        break;
      case 1:
        value = 0;
        p += 8;
        break;
      case 2: {
        const [length, start] = varint(bytes, p);
        if (start + length > bytes.length) throw new Error("Kotlin metadata: truncated protobuf");
        value = bytes.subarray(start, start + length);
        p = start + length;
        break;
      }
      case 5:
        value = 0;
        p += 4;
        break;
      default:
        throw new Error(`Kotlin metadata: unsupported protobuf wire type ${key & 7}`);
    }

    const values = fields.get(field);
    if (values) values.push(value);
    else fields.set(field, [value]);
  }

  return fields;
}

const has = (f: Fields, n: number) => f.has(n);

function int(f: Fields, n: number, fallback = 0): number {
  const values = f.get(n);
  const v = values?.[values.length - 1];
  return typeof v === "number" ? v : fallback;
}

function message(f: Fields, n: number): Fields | undefined {
  const values = f.get(n);
  const v = values?.[values.length - 1];
  return v instanceof Uint8Array ? parse(v) : undefined;
}

function messages(f: Fields, n: number): Fields[] {
  return (f.get(n) ?? []).map((v) => parse(v as Uint8Array));
}

/** A repeated int32, packed or not. */
function ints(f: Fields, n: number): number[] {
  const out: number[] = [];

  for (const v of f.get(n) ?? []) {
    if (typeof v === "number") {
      out.push(v);
      continue;
    }

    for (let p = 0; p < v.length;) {
      const [value, next] = varint(v, p);
      out.push(value);
      p = next;
    }
  }

  return out;
}

/* --- d1 and the string table ----------------------------------------------- */

/** `@Metadata(d1)` back to bytes: UTF-8 mode (a leading `\u0000`) or the older 8-to-7 bit encoding. */
function decodeData1(d1: string[]): Uint8Array {
  const first = d1[0] ?? "";

  if (first.startsWith("\u0000")) {
    const text = first.slice(1) + d1.slice(1).join("");
    const out = new Uint8Array(text.length);
    for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 0xff;
    return out;
  }

  const text = (first.startsWith("\uffff") ? first.slice(1) : first) + d1.slice(1).join("");
  const sevenBit = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) sevenBit[i] = (text.charCodeAt(i) + 0x7f) & 0x7f;

  const out = new Uint8Array(Math.floor((7 * sevenBit.length) / 8));
  let index = 0;
  let bit = 0;

  for (let i = 0; i < out.length; i++) {
    const first = sevenBit[index]! >>> bit;
    index++;
    const second = (sevenBit[index]! & ((1 << (bit + 1)) - 1)) << (7 - bit);
    out[i] = first + second;

    if (bit === 6) {
      index++;
      bit = 0;
    } else bit++;
  }

  return out;
}

const PREDEFINED_STRINGS = [
  "kotlin/Any",
  "kotlin/Nothing",
  "kotlin/Unit",
  "kotlin/Throwable",
  "kotlin/Number",
  "kotlin/Byte",
  "kotlin/Double",
  "kotlin/Float",
  "kotlin/Int",
  "kotlin/Long",
  "kotlin/Short",
  "kotlin/Boolean",
  "kotlin/Char",
  "kotlin/CharSequence",
  "kotlin/String",
  "kotlin/Comparable",
  "kotlin/Enum",
  "kotlin/Array",
  "kotlin/ByteArray",
  "kotlin/DoubleArray",
  "kotlin/FloatArray",
  "kotlin/IntArray",
  "kotlin/LongArray",
  "kotlin/ShortArray",
  "kotlin/BooleanArray",
  "kotlin/CharArray",
  "kotlin/Cloneable",
  "kotlin/Annotation",
  "kotlin/collections/Iterable",
  "kotlin/collections/MutableIterable",
  "kotlin/collections/Collection",
  "kotlin/collections/MutableCollection",
  "kotlin/collections/List",
  "kotlin/collections/MutableList",
  "kotlin/collections/Set",
  "kotlin/collections/MutableSet",
  "kotlin/collections/Map",
  "kotlin/collections/MutableMap",
  "kotlin/collections/Map.Entry",
  "kotlin/collections/MutableMap.MutableEntry",
  "kotlin/collections/Iterator",
  "kotlin/collections/MutableIterator",
  "kotlin/collections/ListIterator",
  "kotlin/collections/MutableListIterator",
];

/** `JvmNameResolver`: strings of the metadata, each through its `StringTableTypes.Record`. */
class NameResolver {
  private readonly records: Fields[] = [];
  private readonly localNames: Set<number>;
  private readonly strings: string[];
  private readonly cache = new Map<number, string>();

  constructor(types: Fields, strings: string[]) {
    this.strings = strings;

    for (const record of messages(types, 1)) {
      for (let i = int(record, 1, 1); i > 0; i--) this.records.push(record);
    }

    this.localNames = new Set(ints(types, 5));
  }

  get(index: number): string {
    const cached = this.cache.get(index);
    if (cached !== undefined) return cached;

    const record = this.records[index];
    if (!record) throw new Error(`Kotlin metadata: no string record ${index}`);

    const predefined = int(record, 2, -1);
    let s = has(record, 6)
      ? new TextDecoder().decode(record.get(6)!.at(-1) as Uint8Array)
      : predefined >= 0 && predefined < PREDEFINED_STRINGS.length
        ? PREDEFINED_STRINGS[predefined]!
        : this.strings[index]!;

    const substring = ints(record, 4);
    if (substring.length >= 2) {
      const [begin, end] = substring as [number, number];
      if (begin >= 0 && begin <= end && end <= s.length) s = s.slice(begin, end);
    }

    const replace = ints(record, 5);
    if (replace.length >= 2) {
      s = s.replaceAll(String.fromCharCode(replace[0]!), String.fromCharCode(replace[1]!));
    }

    switch (int(record, 3, 0)) {
      case 1: // INTERNAL_TO_CLASS_ID
        s = s.replaceAll("$", ".");
        break;
      case 2: // DESC_TO_CLASS_ID
        if (s.length >= 2) s = s.slice(1, -1);
        s = s.replaceAll("$", ".");
        break;
    }

    this.cache.set(index, s);
    return s;
  }

  className(index: number): string {
    const name = this.get(index);
    return this.localNames.has(index) ? `.${name}` : name;
  }
}

/** Splits `d1` bytes into the name resolver (a length-prefixed `StringTableTypes`) and the message after it. */
function readData(d1: string[], d2: string[]): { strings: NameResolver; proto: Fields } {
  const bytes = decodeData1(d1);
  const [length, p] = varint(bytes, 0);

  const types = parse(bytes.subarray(p, p + length));
  return { strings: new NameResolver(types, d2), proto: parse(bytes.subarray(p + length)) };
}

/* --- Flags (Flags.java) ------------------------------------------------------- */

const VISIBILITIES: KotlinVisibility[] = [
  "internal",
  "private",
  "protected",
  "public",
  "private-to-this",
  "local",
];
const MODALITIES: KotlinModality[] = ["final", "open", "abstract", "sealed"];
const CLASS_KINDS: KotlinClassKind[] = [
  "class",
  "interface",
  "enum",
  "enum-entry",
  "annotation",
  "object",
  "companion",
];
const MEMBER_KINDS: KotlinMemberKind[] = [
  "declaration",
  "fake-override",
  "delegation",
  "synthesized",
];
const VARIANCES: KotlinVariance[] = ["in", "out", "invariant"];

const visibility = (flags: number) => VISIBILITIES[(flags >> 1) & 7]!;
const modality = (flags: number) => MODALITIES[(flags >> 4) & 3]!;
const memberKind = (flags: number) => MEMBER_KINDS[(flags >> 6) & 3]!;
const bit = (flags: number, n: number) => (flags & (1 << n)) !== 0;

const isApi = (flags: number) => {
  const v = visibility(flags);
  return v === "public" || v === "protected";
};

/** The flags that are set, as the contract's optional `true` fields. */
function set<K extends string>(flags: Record<K, boolean>): { [P in K]?: true } {
  const out: { [P in K]?: true } = {};
  for (const key in flags) if (flags[key]) out[key] = true;
  return out;
}

/** An optional field, present only when its value is. */
const optional = <K extends string, V>(key: K, value: V | undefined) =>
  (value === undefined ? {} : { [key]: value }) as { [P in K]?: V };

/* --- Declarations (Readers.kt) ---------------------------------------------- */

/*
 * Field numbers read below (ProtoBuf.java; JvmProtoBuf extensions are 100+):
 *
 *   Class          1 flags, 3 fq_name, 4 companion, 5 type_parameter, 6/2 supertype(_id),
 *                  8 constructor, 9 function, 10 property, 13 enum_entry,
 *                  16 sealed_subclass, 17 inline_class_underlying_property_name,
 *                  18/19 its type(_id), 30 type_table
 *   Package        3 function, 4 property, 30 type_table
 *   Constructor    1 flags, 2 value_parameter, 100 JvmMethodSignature
 *   Function       9 flags, 2 name, 3/7 return_type(_id), 4 type_parameter,
 *                  5/8 receiver_type(_id), 6 value_parameter, 10/11 context receivers,
 *                  13 context_parameter, 100 JvmMethodSignature
 *   Property       11 flags, 2 name, 3/9 return_type(_id), 4 type_parameter,
 *                  5/10 receiver_type(_id), 7/8 getter/setter flags, 12/13 context
 *                  receivers, 17 context_parameter, 100 JvmPropertySignature
 *   ValueParameter 1 flags, 2 name, 3/5 type(_id), 4/6 vararg_element_type(_id)
 *   TypeParameter  1 id, 2 name, 3 reified, 4 variance, 5/6 upper_bound(_id)
 *   Type           1 flags, 2 argument, 3 nullable, 5/8 flexible_upper_bound(_id),
 *                  6 class_name, 7 type_parameter, 9 type_parameter_name,
 *                  10/11 outer_type(_id), 12 type_alias_name, 100 type_annotation
 *   Annotation     1 id (a class name)
 *   Type.Argument  1 projection, 2/3 type(_id)
 *   TypeTable      1 type, 2 first_nullable
 *   JvmMethodSignature 1 name, 2 desc; JvmPropertySignature 1 field, 3 getter, 4 setter
 */

interface ProtoType {
  f: Fields;
  /** Past the type table's `first_nullable`. */
  nullable: boolean;
}

/** `ReadContext`: strings, the type table, and type parameter names in scope. */
class Context {
  readonly strings: NameResolver;
  private readonly types: ProtoType[];
  private readonly typeParameterIds: Map<number, number>;
  private readonly parent?: Context;

  constructor(
    strings: NameResolver,
    types: ProtoType[],
    typeParameterIds = new Map<number, number>(),
    parent?: Context,
  ) {
    this.strings = strings;
    this.types = types;
    this.typeParameterIds = typeParameterIds;
    this.parent = parent;
  }

  static of(strings: NameResolver, owner: Fields): Context {
    const table = message(owner, 30);
    const firstNullable = table ? int(table, 2, -1) : -1;
    const types = (table ? messages(table, 1) : []).map((f, i) => ({
      f,
      nullable: firstNullable >= 0 && i >= firstNullable,
    }));

    return new Context(strings, types);
  }

  withTypeParameters(typeParameters: Fields[]): Context {
    const ids = new Map(typeParameters.map((t) => [int(t, 2), int(t, 1)] as const));
    return new Context(this.strings, this.types, ids, this);
  }

  typeParameterId(name: number): number | undefined {
    return this.typeParameterIds.get(name) ?? this.parent?.typeParameterId(name);
  }

  /** An inline type, or else one from the type table by id. */
  type(owner: Fields, inline: number, id: number): ProtoType | undefined {
    const direct = message(owner, inline);
    if (direct) return { f: direct, nullable: false };
    if (!has(owner, id)) return undefined;

    return this.tableType(int(owner, id));
  }

  /** A required type: a declaration's return type, a parameter's type. */
  required(owner: Fields, inline: number, id: number): ProtoType {
    const t = this.type(owner, inline, id);
    if (!t) throw new Error("Kotlin metadata: a declaration without its type");
    return t;
  }

  /** A repeated inline type, or else a repeated id into the type table. */
  typeList(owner: Fields, inline: number, ids: number): ProtoType[] {
    const direct = messages(owner, inline);
    if (direct.length > 0) return direct.map((f) => ({ f, nullable: false }));

    return ints(owner, ids).map((id) => this.tableType(id));
  }

  private tableType(id: number): ProtoType {
    const t = this.types[id];
    if (!t) throw new Error(`Kotlin metadata: no type ${id} in the type table`);
    return t;
  }
}

type ClassBody = Omit<KotlinClass, "jvmName" | "metadataVersion" | "jvmPackageName">;

/** A class's `@Metadata(d1, d2)`; undefined when the class is not API. */
export function decodeClass(d1: string[], d2: string[]): ClassBody | undefined {
  if (d1.length === 0) throw new Error("Kotlin metadata: a class without data");

  const { strings, proto } = readData(d1, d2);
  const flags = int(proto, 1, 6);
  if (!isApi(flags)) return undefined;

  const typeParameterProtos = messages(proto, 5);
  const c = Context.of(strings, proto).withTypeParameters(typeParameterProtos);

  return {
    metadataKind: "class",
    name: strings.className(int(proto, 3)),
    kind: CLASS_KINDS[(flags >> 6) & 7]!,
    visibility: visibility(flags),
    modality: modality(flags),
    ...set({
      data: bit(flags, 10),
      value: bit(flags, 13),
      inner: bit(flags, 9),
      fun: bit(flags, 14),
      expect: bit(flags, 12),
      external: bit(flags, 11),
    }),
    typeParameters: typeParameterProtos.map((t) => typeParameter(t, c)),
    supertypes: c.typeList(proto, 6, 2).map((t) => type(t, c)),
    constructors: messages(proto, 8)
      .filter((k) => isApi(int(k, 1, 6)))
      .map((k) => constructor(k, c)),
    functions: functions(proto, 9, c),
    properties: properties(proto, 10, c),
    ...optional("companionObject", has(proto, 4) ? strings.get(int(proto, 4)) : undefined),
    enumEntries: messages(proto, 13).map((e) => {
      if (!has(e, 1)) throw new Error("Kotlin metadata: no name for EnumEntry");
      return strings.get(int(e, 1));
    }),
    sealedSubclasses: ints(proto, 16).map((i) => strings.className(i)),
    ...optional("valueClass", valueClass(proto, c)),
  };
}

function valueClass(proto: Fields, c: Context): KotlinClass["valueClass"] {
  if (!has(proto, 17)) return undefined;

  const property = c.strings.get(int(proto, 17));

  // Kotlin writes no underlying type when the underlying property has it.
  const candidates = messages(proto, 10).filter(
    (p) => !c.type(p, 5, 10) && c.strings.get(int(p, 2)) === property,
  );
  const underlying =
    c.type(proto, 18, 19) ??
    (candidates.length === 1 ? c.required(candidates[0]!, 3, 9) : undefined);

  return underlying && { property, type: type(underlying, c) };
}

/** A file facade's or multi-file part's `Package`: its functions and properties. */
export function decodePackage(
  d1: string[],
  d2: string[],
): { functions: KotlinFunction[]; properties: KotlinProperty[] } {
  if (d1.length === 0) throw new Error("Kotlin metadata: a package without data");

  const { strings, proto } = readData(d1, d2);
  const c = Context.of(strings, proto);

  return { functions: functions(proto, 3, c), properties: properties(proto, 4, c) };
}

function constructor(k: Fields, c: Context): KotlinConstructor {
  const flags = int(k, 1, 6);
  const parameterProtos = messages(k, 2);
  const signature = message(k, 100);

  const descriptor =
    signature && has(signature, 2)
      ? c.strings.get(int(signature, 2))
      : defaultDescriptor(
          parameterProtos.map((p) => c.required(p, 3, 5)),
          undefined,
          c,
        );
  const name = signature && has(signature, 1) ? c.strings.get(int(signature, 1)) : "<init>";

  return {
    visibility: visibility(flags),
    ...set({ secondary: bit(flags, 4) }),
    parameters: parameterProtos.map((p) => valueParameter(p, c)),
    ...optional("jvm", descriptor === undefined ? undefined : { name, descriptor }),
  };
}

function functions(owner: Fields, field: number, outer: Context): KotlinFunction[] {
  return messages(owner, field)
    .filter((f) => isApi(int(f, 9, 6)))
    .map((f) => fn(f, outer));
}

function fn(f: Fields, outer: Context): KotlinFunction {
  const flags = int(f, 9, 6);
  const typeParameterProtos = messages(f, 4);
  const c = outer.withTypeParameters(typeParameterProtos);
  const receiver = c.type(f, 5, 8);
  const parameterProtos = messages(f, 6);
  const result = c.required(f, 3, 7);
  const context = contextParameters(f, 13, 10, 11, c);

  const signature = message(f, 100);
  const descriptor =
    signature && has(signature, 2)
      ? c.strings.get(int(signature, 2))
      : defaultDescriptor(
          [...(receiver ? [receiver] : []), ...parameterProtos.map((p) => c.required(p, 3, 5))],
          result,
          c,
        );
  const jvmName = c.strings.get(signature && has(signature, 1) ? int(signature, 1) : int(f, 2));

  return {
    name: c.strings.get(int(f, 2)),
    ...optional("jvm", descriptor === undefined ? undefined : { name: jvmName, descriptor }),
    visibility: visibility(flags),
    modality: modality(flags),
    memberKind: memberKind(flags),
    ...set({
      suspend: bit(flags, 13),
      inline: bit(flags, 10),
      operator: bit(flags, 8),
      infix: bit(flags, 9),
      tailrec: bit(flags, 11),
      external: bit(flags, 12),
      expect: bit(flags, 14),
    }),
    typeParameters: typeParameterProtos.map((t) => typeParameter(t, c)),
    ...optional("receiver", receiver && type(receiver, c)),
    ...optional("contextParameters", context.length > 0 ? context : undefined),
    parameters: parameterProtos.map((p) => valueParameter(p, c)),
    returnType: type(result, c),
  };
}

function properties(owner: Fields, field: number, outer: Context): KotlinProperty[] {
  return messages(owner, field)
    .filter((p) => isApi(int(p, 11, 518)))
    .map((p) => property(p, outer));
}

function property(p: Fields, outer: Context): KotlinProperty {
  const flags = int(p, 11, 518);
  const typeParameterProtos = messages(p, 4);
  const c = outer.withTypeParameters(typeParameterProtos);
  const receiver = c.type(p, 5, 10);
  const result = c.required(p, 3, 9);
  const context = contextParameters(p, 17, 12, 13, c);
  const signature = message(p, 100);

  // Accessors without their own flags take the property's visibility and modality.
  const accessorFlags = (field: number) => (has(p, field) ? int(p, field) : flags & 0x3f);
  const setterFlags = accessorFlags(8);
  const hasSetter = bit(flags, 10) && isApi(setterFlags);

  return {
    name: c.strings.get(int(p, 2)),
    visibility: visibility(flags),
    modality: modality(flags),
    memberKind: memberKind(flags),
    ...set({
      mutable: bit(flags, 8),
      const: bit(flags, 11),
      lateinit: bit(flags, 12),
      delegated: bit(flags, 15),
      expect: bit(flags, 16),
      external: bit(flags, 14),
    }),
    typeParameters: typeParameterProtos.map((t) => typeParameter(t, c)),
    ...optional("receiver", receiver && type(receiver, c)),
    ...optional("contextParameters", context.length > 0 ? context : undefined),
    type: type(result, c),
    getter: accessor(accessorFlags(7), signature && message(signature, 3), c),
    ...optional(
      "setter",
      hasSetter ? accessor(setterFlags, signature && message(signature, 4), c) : undefined,
    ),
    ...optional("field", backingField(p, signature, result, c)),
  };
}

/** `JvmProtoBufUtil.getJvmFieldSignature`: the field's name defaults to the property's, its descriptor to the type's. */
function backingField(
  p: Fields,
  signature: Fields | undefined,
  result: ProtoType,
  c: Context,
): JvmSignature | undefined {
  const field = signature && message(signature, 1);
  if (!field) return undefined;

  const name = c.strings.get(has(field, 1) ? int(field, 1) : int(p, 2));
  const descriptor = has(field, 2) ? c.strings.get(int(field, 2)) : mapTypeDefault(result, c);

  return descriptor === undefined ? undefined : { name, descriptor };
}

function accessor(flags: number, signature: Fields | undefined, c: Context): KotlinAccessor {
  return {
    visibility: visibility(flags),
    modality: modality(flags),
    ...optional(
      "jvm",
      signature && {
        name: c.strings.get(int(signature, 1)),
        descriptor: c.strings.get(int(signature, 2)),
      },
    ),
    ...set({ notDefault: bit(flags, 6), inline: bit(flags, 8), external: bit(flags, 7) }),
  };
}

/** Context parameters, or legacy context receivers read as parameters named `_`. */
function contextParameters(
  owner: Fields,
  field: number,
  legacyInline: number,
  legacyIds: number,
  c: Context,
): KotlinValueParameter[] {
  const parameters = messages(owner, field);
  if (parameters.length > 0) return parameters.map((p) => valueParameter(p, c));

  return c.typeList(owner, legacyInline, legacyIds).map((t) => ({ name: "_", type: type(t, c) }));
}

function valueParameter(p: Fields, c: Context): KotlinValueParameter {
  const flags = int(p, 1, 0);
  const vararg = c.type(p, 4, 6);

  return {
    name: c.strings.get(int(p, 2)),
    type: type(c.required(p, 3, 5), c),
    ...set({ declaresDefault: bit(flags, 1) }),
    ...optional("vararg", vararg && type(vararg, c)),
    ...set({ crossinline: bit(flags, 2), noinline: bit(flags, 3) }),
  };
}

function typeParameter(t: Fields, c: Context): KotlinTypeParameter {
  return {
    id: int(t, 1),
    name: c.strings.get(int(t, 2)),
    variance: VARIANCES[int(t, 4, 2)]!,
    ...set({ reified: int(t, 3) !== 0 }),
    upperBounds: c.typeList(t, 5, 6).map((b) => type(b, c)),
  };
}

function type(t: ProtoType, c: Context): KotlinType {
  const f = t.f;
  const flags = int(f, 1, 0);
  const outer = c.type(f, 10, 11);
  const annotations = messages(f, 100).map((a) => c.strings.className(int(a, 1)));

  return {
    classifier: classifier(f, c),
    nullable: t.nullable || int(f, 3) !== 0,
    arguments: messages(f, 2).map((a) => {
      const projection = int(a, 1, 2);
      if (projection === 3) return "*";

      const argument = c.type(a, 2, 3);
      if (!argument) throw new Error("Kotlin metadata: no type for a non-star projection");
      return { variance: VARIANCES[projection]!, type: type(argument, c) };
    }),
    ...set({
      platform: c.type(f, 5, 8) !== undefined,
      suspend: bit(flags, 0),
      definitelyNonNull: bit(flags, 1),
    }),
    ...optional("outer", outer && type(outer, c)),
    ...optional("annotations", annotations.length > 0 ? annotations : undefined),
  };
}

function classifier(f: Fields, c: Context): KotlinType["classifier"] {
  if (has(f, 6)) return { class: c.strings.className(int(f, 6)) };
  if (has(f, 12)) return { typeAlias: c.strings.className(int(f, 12)) };
  if (has(f, 7)) return { typeParameter: int(f, 7) };

  if (has(f, 9)) {
    const id = c.typeParameterId(int(f, 9));
    if (id === undefined) {
      throw new Error(`Kotlin metadata: no type parameter id for ${c.strings.get(int(f, 9))}`);
    }
    return { typeParameter: id };
  }

  throw new Error("Kotlin metadata: a type without a classifier");
}

/* --- Default JVM descriptors (ClassMapperLite.kt) ------------------------------ */

const CLASS_DESCRIPTORS = (() => {
  const map = new Map<string, string>();
  const primitives: [string, string][] = [
    ["Boolean", "Z"],
    ["Char", "C"],
    ["Byte", "B"],
    ["Short", "S"],
    ["Int", "I"],
    ["Float", "F"],
    ["Long", "J"],
    ["Double", "D"],
  ];

  for (const [name, d] of primitives) {
    map.set(`kotlin/${name}`, d);
    map.set(`kotlin/${name}Array`, `[${d}`);
  }

  map.set("kotlin/Unit", "V");

  const add = (kotlin: string, java: string) => map.set(`kotlin/${kotlin}`, `L${java};`);
  add("Any", "java/lang/Object");
  add("Nothing", "java/lang/Void");
  add("Annotation", "java/lang/annotation/Annotation");

  for (const name of [
    "String",
    "CharSequence",
    "Throwable",
    "Cloneable",
    "Number",
    "Comparable",
    "Enum",
  ]) {
    add(name, `java/lang/${name}`);
  }

  for (const name of ["Iterator", "Collection", "List", "Set", "Map", "ListIterator"]) {
    add(`collections/${name}`, `java/util/${name}`);
    add(`collections/Mutable${name}`, `java/util/${name}`);
  }

  add("collections/Iterable", "java/lang/Iterable");
  add("collections/MutableIterable", "java/lang/Iterable");
  add("collections/Map.Entry", "java/util/Map$Entry");
  add("collections/MutableMap.MutableEntry", "java/util/Map$Entry");

  for (let i = 0; i <= 22; i++) {
    add(`Function${i}`, `kotlin/jvm/functions/Function${i}`);
    add(`reflect/KFunction${i}`, "kotlin/reflect/KFunction");
  }

  for (const name of [
    "Char",
    "Byte",
    "Short",
    "Int",
    "Float",
    "Long",
    "Double",
    "String",
    "Enum",
  ]) {
    add(`${name}.Companion`, `kotlin/jvm/internal/${name}CompanionObject`);
  }

  return map;
})();

/**
 * The JVM type of a Kotlin class, as a descriptor: `kotlin/Int` is `I`,
 * `kotlin/collections/List` is `Ljava/util/List;`, a nested class is its
 * `$` binary name. What a value class or a nullable primitive becomes
 * depends on where it is, which this does not know.
 */
export function jvmDescriptorOf(kotlinClass: string): string {
  return CLASS_DESCRIPTORS.get(kotlinClass) ?? `L${kotlinClass.replaceAll(".", "$")};`;
}

/** The Kotlin classes the JVM classes above stand for; the mutable one where both map to it. */
const KOTLIN_CLASSES = (() => {
  const map = new Map<string, string>();

  for (const [kotlin, descriptor] of CLASS_DESCRIPTORS)
    if (descriptor.startsWith("L")) map.set(descriptor.slice(1, -1), kotlin);

  return map;
})();

/**
 * The Kotlin class a JVM class is in Kotlin source, `/`-separated:
 * `java/util/List` is `kotlin/collections/MutableList`, `java/lang/String`
 * `kotlin/String`, a nested `a/B$C` is `a/B.C`.
 */
export function kotlinClassOf(jvmInternal: string): string {
  return KOTLIN_CLASSES.get(jvmInternal) ?? jvmInternal.replaceAll("$", ".");
}

function mapTypeDefault(t: ProtoType, c: Context): string | undefined {
  if (!has(t.f, 6)) return undefined;

  return jvmDescriptorOf(c.strings.get(int(t.f, 6)));
}

/** The descriptor Kotlin leaves out of metadata when it follows from the Kotlin types; `V` for constructors. */
function defaultDescriptor(
  parameters: ProtoType[],
  result: ProtoType | undefined,
  c: Context,
): string | undefined {
  const mapped = parameters.map((p) => mapTypeDefault(p, c));
  const returned = result ? mapTypeDefault(result, c) : "V";
  if (returned === undefined || mapped.some((m) => m === undefined)) return undefined;
  return `(${mapped.join("")})${returned}`;
}
