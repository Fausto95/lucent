/**
 * The normalized form of Kotlin metadata (the `@kotlin.Metadata` annotation
 * kotlinc writes on every class file), as the Android extractor consumes it.
 *
 * Kotlin source meaning the JVM erases lives only there: `suspend`, which
 * parameters declare defaults, nullability, properties and their accessors,
 * value and sealed classes, extension receivers, and which class holds the
 * top-level declarations of a file. Every JVM member keeps its exact JVM
 * signature beside that meaning, so shims can call it.
 *
 * Only API declarations appear: public and protected ones. Private, internal
 * and local classes, functions, properties, constructors and setters are left
 * out, as a Kotlin caller would not see them either.
 *
 * Readers produce this JSON from a batch of jars, AARs and class directories
 * without loading any class. Optional flags are present only when true;
 * arrays are always present, except `contextParameters`, which is omitted
 * when empty.
 */

/** Bumped when the JSON below changes shape. */
export const KOTLIN_METADATA_FORMAT = 1;

export interface KotlinMetadataBatch {
  format: typeof KOTLIN_METADATA_FORMAT;
  /** One entry per input, in the order given. */
  inputs: KotlinMetadataInput[];
}

export interface KotlinMetadataInput {
  /** The jar, AAR or class directory, as passed to the reader. */
  path: string;
  /** Sorted by `jvmName`. */
  declarations: KotlinDeclaration[];
}

export type KotlinDeclaration =
  | KotlinClass
  | KotlinFileFacade
  | KotlinMultiFileFacade
  | KotlinMultiFilePart
  | KotlinSyntheticClass;

interface KotlinClassFileBase {
  /** The class file's internal name: `dev/orbit/search/SearchClient$Companion`. */
  jvmName: string;
  /** `@Metadata(mv)`, dotted: `2.4.0`. */
  metadataVersion: string;
  /** `@Metadata(pn)`, when `@JvmPackageName` moved the class out of its Kotlin package. */
  jvmPackageName?: string;
}

/** `@Metadata(k = 1)`: a class, interface, object or annotation. */
export interface KotlinClass extends KotlinClassFileBase {
  metadataKind: "class";
  /** Kotlin class name: `/` between packages, `.` between nested classes (`dev/orbit/search/SearchClient.Companion`). */
  name: string;
  kind: KotlinClassKind;
  visibility: KotlinVisibility;
  modality: KotlinModality;
  data?: true;
  value?: true;
  inner?: true;
  fun?: true;
  expect?: true;
  external?: true;
  typeParameters: KotlinTypeParameter[];
  supertypes: KotlinType[];
  constructors: KotlinConstructor[];
  functions: KotlinFunction[];
  properties: KotlinProperty[];
  /** The simple name of the companion object, when there is one. */
  companionObject?: string;
  enumEntries: string[];
  /** Kotlin class names of every direct subclass of a sealed class, whatever their visibility. */
  sealedSubclasses: string[];
  /** A value class's single underlying property. */
  valueClass?: { property: string; type: KotlinType };
}

/** `@Metadata(k = 2)`: the class holding one file's top-level declarations (`ExtensionsKt`). */
export interface KotlinFileFacade extends KotlinClassFileBase {
  metadataKind: "file-facade";
  functions: KotlinFunction[];
  properties: KotlinProperty[];
}

/** `@Metadata(k = 4)`: a facade that `@JvmMultifileClass` files share; its members live in the parts. */
export interface KotlinMultiFileFacade extends KotlinClassFileBase {
  metadataKind: "multi-file-facade";
  /** JVM internal names of the parts. */
  parts: string[];
}

/** `@Metadata(k = 5)`: one file of a multi-file facade. Callers call the facade, not the part. */
export interface KotlinMultiFilePart extends KotlinClassFileBase {
  metadataKind: "multi-file-part";
  /** JVM internal name of the facade whose static methods delegate here. */
  facade: string;
  functions: KotlinFunction[];
  properties: KotlinProperty[];
}

/** `@Metadata(k = 3)`: compiler plumbing (lambdas, `$WhenMappings`, `$DefaultImpls`). */
export interface KotlinSyntheticClass extends KotlinClassFileBase {
  metadataKind: "synthetic";
}

export type KotlinClassKind =
  | "class"
  | "interface"
  | "enum"
  | "enum-entry"
  | "annotation"
  | "object"
  | "companion";

export type KotlinVisibility =
  | "internal"
  | "private"
  | "protected"
  | "public"
  | "private-to-this"
  | "local";

export type KotlinModality = "final" | "open" | "abstract" | "sealed";

/** Whether a member was written, or generated (`componentN`, `copy`) or inherited by delegation. */
export type KotlinMemberKind = "declaration" | "fake-override" | "delegation" | "synthesized";

/** A JVM method or field: the name and descriptor to find it with, over JNI or in the class file. */
export interface JvmSignature {
  name: string;
  descriptor: string;
}

export interface KotlinConstructor {
  visibility: KotlinVisibility;
  secondary?: true;
  parameters: KotlinValueParameter[];
  /** `<init>` and its descriptor; absent only when the metadata cannot name it. */
  jvm?: JvmSignature;
}

export interface KotlinFunction {
  name: string;
  /**
   * The JVM method. A suspend function's descriptor keeps its trailing
   * `Continuation` parameter, which `parameters` does not list; an extension's
   * starts with the receiver. The `$default` bridge for defaults is not listed.
   */
  jvm?: JvmSignature;
  visibility: KotlinVisibility;
  modality: KotlinModality;
  memberKind: KotlinMemberKind;
  suspend?: true;
  inline?: true;
  operator?: true;
  infix?: true;
  tailrec?: true;
  external?: true;
  expect?: true;
  typeParameters: KotlinTypeParameter[];
  /** An extension's receiver, which the JVM passes as the first parameter. */
  receiver?: KotlinType;
  contextParameters?: KotlinValueParameter[];
  /** Source parameters, without the receiver or a suspend function's continuation. */
  parameters: KotlinValueParameter[];
  returnType: KotlinType;
}

export interface KotlinValueParameter {
  name: string;
  type: KotlinType;
  /** Callers may omit it: a `$default` bridge or overload supplies the value. */
  declaresDefault?: true;
  /** The element type of a `vararg` parameter, whose `type` is the array. */
  vararg?: KotlinType;
  crossinline?: true;
  noinline?: true;
}

export interface KotlinProperty {
  name: string;
  visibility: KotlinVisibility;
  modality: KotlinModality;
  memberKind: KotlinMemberKind;
  /** `var`. A `var` whose setter is not API has no `setter` here. */
  mutable?: true;
  const?: true;
  lateinit?: true;
  delegated?: true;
  expect?: true;
  external?: true;
  typeParameters: KotlinTypeParameter[];
  /** An extension property's receiver, the first parameter of its accessors. */
  receiver?: KotlinType;
  contextParameters?: KotlinValueParameter[];
  type: KotlinType;
  getter: KotlinAccessor;
  setter?: KotlinAccessor;
  /** The backing field, when the property has one. */
  field?: JvmSignature;
}

export interface KotlinAccessor {
  visibility: KotlinVisibility;
  modality: KotlinModality;
  /** Absent when there is no accessor method (`@JvmField`, `const`). */
  jvm?: JvmSignature;
  /** Written in source rather than generated. */
  notDefault?: true;
  inline?: true;
  external?: true;
}

export interface KotlinTypeParameter {
  /** What `KotlinClassifier.typeParameter` refers to; unique within a class and its members. */
  id: number;
  name: string;
  variance: KotlinVariance;
  reified?: true;
  upperBounds: KotlinType[];
}

export type KotlinVariance = "in" | "out" | "invariant";

export interface KotlinType {
  classifier: KotlinClassifier;
  nullable: boolean;
  /** Type arguments; `"*"` is a star projection. */
  arguments: ("*" | { variance: KotlinVariance; type: KotlinType })[];
  /** The type of a Java declaration (`String!`): nullability unknown. */
  platform?: true;
  /** A suspend function type (`suspend (A) -> B`). */
  suspend?: true;
  /** `T & Any`. */
  definitelyNonNull?: true;
  /** For an inner class, the outer class's type (with its arguments). */
  outer?: KotlinType;
  /**
   * The Kotlin class names of its type annotations, in order: a function
   * type's `kotlin/ExtensionFunctionType` (its first argument is the
   * receiver), or a compiler plugin's (`androidx/compose/runtime/Composable`).
   */
  annotations?: string[];
}

/**
 * A Kotlin class name (`kotlin/collections/List`, not `java/util/List`;
 * mapping it to a JVM class is the consumer's), a type parameter's id, or a
 * type alias left unexpanded.
 */
export type KotlinClassifier =
  | { class: string }
  | { typeParameter: number }
  | { typeAlias: string };

export type JvmMemberRole = "constructor" | "function" | "getter" | "setter";

/**
 * Every JVM method of a declaration that the metadata names, keyed by
 * `name + descriptor`, with the source declaration it implements. A method
 * missing here is not API as Kotlin sees it (a `$default` bridge, a
 * suspend state machine, a private member).
 */
export function jvmMemberRoles(
  declaration: KotlinDeclaration,
): Map<string, { role: JvmMemberRole; name: string }> {
  const roles = new Map<string, { role: JvmMemberRole; name: string }>();
  const add = (jvm: JvmSignature | undefined, role: JvmMemberRole, name: string) => {
    if (jvm) roles.set(jvm.name + jvm.descriptor, { role, name });
  };

  if (declaration.metadataKind === "class") {
    for (const c of declaration.constructors) add(c.jvm, "constructor", "<init>");
  }

  if ("functions" in declaration) {
    for (const f of declaration.functions) add(f.jvm, "function", f.name);

    for (const p of declaration.properties) {
      add(p.getter.jvm, "getter", p.name);
      add(p.setter?.jvm, "setter", p.name);
    }
  }

  return roles;
}
