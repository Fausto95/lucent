@file:OptIn(ExperimentalContextParameters::class)

package lucent.kotlinmetadata

import kotlin.metadata.ClassKind
import kotlin.metadata.KmClass
import kotlin.metadata.KmClassifier
import kotlin.metadata.KmConstructor
import kotlin.metadata.KmFunction
import kotlin.metadata.KmProperty
import kotlin.metadata.KmPropertyAccessorAttributes
import kotlin.metadata.KmType
import kotlin.metadata.KmTypeParameter
import kotlin.metadata.KmValueParameter
import kotlin.metadata.KmVariance
import kotlin.metadata.MemberKind
import kotlin.metadata.Modality
import kotlin.metadata.Visibility
import kotlin.metadata.declaresDefaultValue
import kotlin.metadata.isConst
import kotlin.metadata.isCrossinline
import kotlin.metadata.isData
import kotlin.metadata.isDefinitelyNonNull
import kotlin.metadata.isDelegated
import kotlin.metadata.isExpect
import kotlin.metadata.isExternal
import kotlin.metadata.isFunInterface
import kotlin.metadata.isInfix
import kotlin.metadata.isInline
import kotlin.metadata.isInner
import kotlin.metadata.isLateinit
import kotlin.metadata.isNoinline
import kotlin.metadata.isNotDefault
import kotlin.metadata.isNullable
import kotlin.metadata.isOperator
import kotlin.metadata.isReified
import kotlin.metadata.isSecondary
import kotlin.metadata.isSuspend
import kotlin.metadata.isTailrec
import kotlin.metadata.isValue
import kotlin.metadata.isVar
import kotlin.metadata.jvm.JvmFieldSignature
import kotlin.metadata.jvm.JvmMethodSignature
import kotlin.metadata.jvm.KotlinClassMetadata
import kotlin.metadata.jvm.annotations
import kotlin.metadata.jvm.fieldSignature
import kotlin.metadata.jvm.getterSignature
import kotlin.metadata.jvm.setterSignature
import kotlin.metadata.jvm.signature
import kotlin.metadata.kind
import kotlin.metadata.modality
import kotlin.metadata.visibility

/*
 * Kotlin metadata, read by the official kotlin-metadata-jvm library, in the
 * normalized JSON shape of packages/bindgen/src/kotlin-metadata.ts. JSON
 * values are plain maps, lists, strings, numbers and booleans; optional flags
 * are present only when true.
 */

typealias Json = MutableMap<String, Any?>

/** The normalized declaration of one class file, or null when it is not API. */
fun normalize(header: MetadataHeader): Json? {
  val metadata = try {
    KotlinClassMetadata.readStrict(header.metadata)
  } catch (e: IllegalArgumentException) {
    throw IllegalArgumentException("${header.jvmName}: ${e.message}", e)
  }

  val base = json("jvmName" to header.jvmName, "metadataVersion" to header.metadata.metadataVersion.joinToString("."))
  if (header.metadata.packageName.isNotEmpty()) base["jvmPackageName"] = header.metadata.packageName

  when (metadata) {
    is KotlinClassMetadata.Class -> return kmClass(metadata.kmClass)?.let { base + it }

    is KotlinClassMetadata.FileFacade ->
      return base + json(
        "metadataKind" to "file-facade",
        "functions" to functions(metadata.kmPackage.functions),
        "properties" to properties(metadata.kmPackage.properties),
      )

    is KotlinClassMetadata.MultiFileClassFacade ->
      return base + json("metadataKind" to "multi-file-facade", "parts" to metadata.partClassNames)

    is KotlinClassMetadata.MultiFileClassPart ->
      return base + json(
        "metadataKind" to "multi-file-part",
        "facade" to metadata.facadeClassName,
        "functions" to functions(metadata.kmPackage.functions),
        "properties" to properties(metadata.kmPackage.properties),
      )

    is KotlinClassMetadata.SyntheticClass -> return base + json("metadataKind" to "synthetic")

    is KotlinClassMetadata.Unknown ->
      throw IllegalArgumentException("${header.jvmName}: unknown Kotlin metadata kind ${header.metadata.kind}")
  }
}

private fun isApi(visibility: Visibility) = visibility == Visibility.PUBLIC || visibility == Visibility.PROTECTED

private fun kmClass(c: KmClass): Json? {
  if (!isApi(c.visibility)) return null

  val out = json(
    "metadataKind" to "class",
    "name" to c.name,
    "kind" to classKind(c.kind),
    "visibility" to visibility(c.visibility),
    "modality" to modality(c.modality),
  )
  flag(out, "data", c.isData)
  flag(out, "value", c.isValue)
  flag(out, "inner", c.isInner)
  flag(out, "fun", c.isFunInterface)
  flag(out, "expect", c.isExpect)
  flag(out, "external", c.isExternal)

  out["typeParameters"] = c.typeParameters.map(::typeParameter)
  out["supertypes"] = c.supertypes.map(::type)
  out["constructors"] = c.constructors.filter { isApi(it.visibility) }.map(::constructor)
  out["functions"] = functions(c.functions)
  out["properties"] = properties(c.properties)
  c.companionObject?.let { out["companionObject"] = it }
  out["enumEntries"] = c.kmEnumEntries.map { it.name }
  out["sealedSubclasses"] = c.sealedSubclasses

  val underlying = c.inlineClassUnderlyingPropertyName
  val underlyingType = c.inlineClassUnderlyingType
  if (underlying != null && underlyingType != null) {
    out["valueClass"] = json("property" to underlying, "type" to type(underlyingType))
  }

  return out
}

private fun constructor(c: KmConstructor): Json {
  val out = json("visibility" to visibility(c.visibility))
  flag(out, "secondary", c.isSecondary)
  out["parameters"] = c.valueParameters.map(::valueParameter)
  c.signature?.let { out["jvm"] = signature(it) }
  return out
}

private fun functions(functions: List<KmFunction>) = functions.filter { isApi(it.visibility) }.map(::function)

private fun function(f: KmFunction): Json {
  val out = json("name" to f.name)
  f.signature?.let { out["jvm"] = signature(it) }
  out["visibility"] = visibility(f.visibility)
  out["modality"] = modality(f.modality)
  out["memberKind"] = memberKind(f.kind)
  flag(out, "suspend", f.isSuspend)
  flag(out, "inline", f.isInline)
  flag(out, "operator", f.isOperator)
  flag(out, "infix", f.isInfix)
  flag(out, "tailrec", f.isTailrec)
  flag(out, "external", f.isExternal)
  flag(out, "expect", f.isExpect)

  out["typeParameters"] = f.typeParameters.map(::typeParameter)
  f.receiverParameterType?.let { out["receiver"] = type(it) }
  if (f.contextParameters.isNotEmpty()) out["contextParameters"] = f.contextParameters.map(::valueParameter)
  out["parameters"] = f.valueParameters.map(::valueParameter)
  out["returnType"] = type(f.returnType)
  return out
}

private fun properties(properties: List<KmProperty>) = properties.filter { isApi(it.visibility) }.map(::property)

private fun property(p: KmProperty): Json {
  val out = json(
    "name" to p.name,
    "visibility" to visibility(p.visibility),
    "modality" to modality(p.modality),
    "memberKind" to memberKind(p.kind),
  )
  flag(out, "mutable", p.isVar)
  flag(out, "const", p.isConst)
  flag(out, "lateinit", p.isLateinit)
  flag(out, "delegated", p.isDelegated)
  flag(out, "expect", p.isExpect)
  flag(out, "external", p.isExternal)

  out["typeParameters"] = p.typeParameters.map(::typeParameter)
  p.receiverParameterType?.let { out["receiver"] = type(it) }
  if (p.contextParameters.isNotEmpty()) out["contextParameters"] = p.contextParameters.map(::valueParameter)
  out["type"] = type(p.returnType)
  out["getter"] = accessor(p.getter, p.getterSignature)

  val setter = p.setter
  if (setter != null && isApi(setter.visibility)) out["setter"] = accessor(setter, p.setterSignature)

  p.fieldSignature?.let { out["field"] = signature(it) }
  return out
}

private fun accessor(a: KmPropertyAccessorAttributes, jvm: JvmMethodSignature?): Json {
  val out = json("visibility" to visibility(a.visibility), "modality" to modality(a.modality))
  jvm?.let { out["jvm"] = signature(it) }
  flag(out, "notDefault", a.isNotDefault)
  flag(out, "inline", a.isInline)
  flag(out, "external", a.isExternal)
  return out
}

private fun valueParameter(p: KmValueParameter): Json {
  val out = json("name" to p.name, "type" to type(p.type))
  flag(out, "declaresDefault", p.declaresDefaultValue)
  p.varargElementType?.let { out["vararg"] = type(it) }
  flag(out, "crossinline", p.isCrossinline)
  flag(out, "noinline", p.isNoinline)
  return out
}

private fun typeParameter(t: KmTypeParameter): Json {
  val out = json("id" to t.id, "name" to t.name, "variance" to variance(t.variance))
  flag(out, "reified", t.isReified)
  out["upperBounds"] = t.upperBounds.map(::type)
  return out
}

private fun type(t: KmType): Json {
  val classifier = when (val c = t.classifier) {
    is KmClassifier.Class -> json("class" to c.name)
    is KmClassifier.TypeParameter -> json("typeParameter" to c.id)
    is KmClassifier.TypeAlias -> json("typeAlias" to c.name)
  }

  val out = json("classifier" to classifier, "nullable" to t.isNullable)
  out["arguments"] = t.arguments.map { a ->
    val argType = a.type
    val argVariance = a.variance
    if (argType == null || argVariance == null) "*" else json("variance" to variance(argVariance), "type" to type(argType))
  }
  flag(out, "platform", t.flexibleTypeUpperBound != null)
  flag(out, "suspend", t.isSuspend)
  flag(out, "definitelyNonNull", t.isDefinitelyNonNull)
  t.outerType?.let { out["outer"] = type(it) }
  if (t.annotations.isNotEmpty()) out["annotations"] = t.annotations.map { it.className }
  return out
}

private fun signature(s: JvmMethodSignature) = json("name" to s.name, "descriptor" to s.descriptor)

private fun signature(s: JvmFieldSignature) = json("name" to s.name, "descriptor" to s.descriptor)

private fun classKind(k: ClassKind) = when (k) {
  ClassKind.CLASS -> "class"
  ClassKind.INTERFACE -> "interface"
  ClassKind.ENUM_CLASS -> "enum"
  ClassKind.ENUM_ENTRY -> "enum-entry"
  ClassKind.ANNOTATION_CLASS -> "annotation"
  ClassKind.OBJECT -> "object"
  ClassKind.COMPANION_OBJECT -> "companion"
}

private fun visibility(v: Visibility) = when (v) {
  Visibility.INTERNAL -> "internal"
  Visibility.PRIVATE -> "private"
  Visibility.PROTECTED -> "protected"
  Visibility.PUBLIC -> "public"
  Visibility.PRIVATE_TO_THIS -> "private-to-this"
  Visibility.LOCAL -> "local"
}

private fun modality(m: Modality) = when (m) {
  Modality.FINAL -> "final"
  Modality.OPEN -> "open"
  Modality.ABSTRACT -> "abstract"
  Modality.SEALED -> "sealed"
}

private fun memberKind(k: MemberKind) = when (k) {
  MemberKind.DECLARATION -> "declaration"
  MemberKind.FAKE_OVERRIDE -> "fake-override"
  MemberKind.DELEGATION -> "delegation"
  MemberKind.SYNTHESIZED -> "synthesized"
}

private fun variance(v: KmVariance) = when (v) {
  KmVariance.IN -> "in"
  KmVariance.OUT -> "out"
  KmVariance.INVARIANT -> "invariant"
}

private fun json(vararg entries: Pair<String, Any?>): Json = linkedMapOf(*entries)

private operator fun Json.plus(other: Json): Json = apply { putAll(other) }

private fun flag(out: Json, name: String, value: Boolean) {
  if (value) out[name] = true
}
