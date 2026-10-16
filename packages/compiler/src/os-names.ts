/**
 * The names of Lucent classes the OS makes. On Android (decision 0097):
 * `dev.lucent.app.<module>.<Class>`. The module's name (`<package>/<path>`)
 * becomes package segments, every character but letters and digits `_`,
 * and a segment Java would refuse gets a `_` in front. On iOS (decision
 * 0124), `LucentApp_<module>_<Class>`. Without TypeScript: lucent.json's
 * components and app extensions name classes by them.
 */

/** Java's keywords and literals, which a package segment can't be. */
const JAVA_RESERVED = new Set(
  (
    "abstract assert boolean break byte case catch char class const continue default do double " +
    "else enum extends final finally float for goto if implements import instanceof int interface " +
    "long native new package private protected public return short static strictfp super switch " +
    "synchronized this throw throws transient try void volatile while true false null _"
  ).split(" "),
);

/** The JNI name (`dev/lucent/app/m/Echo`) of class `name` of module `module`. */
export function osJavaName(module: string, name: string): string {
  const segment = (s: string) => {
    const t = s.replace(/[^A-Za-z0-9]/g, "_");
    return /^[0-9]/.test(t) || JAVA_RESERVED.has(t) ? `_${t}` : t;
  };
  return ["dev/lucent/app", ...module.split("/").map(segment), name].join("/");
}

/**
 * The Objective-C class the OS makes on iOS for class `name` of module
 * `module` (decision 0124): `LucentApp_<module>_<Class>`, every character
 * of the module's name but letters and digits `_`. An extension's
 * `NSExtensionPrincipalClass` names it.
 */
export function osObjcName(module: string, name: string): string {
  return `LucentApp_${module.replace(/[^A-Za-z0-9]/g, "_")}_${name}`;
}

/**
 * A widget's Swift names start with `LucentWidget_<extension>` (decision
 * 0124), its target's name with `-` as `_`: the widget its extension's
 * entry point names, and its view, values, entry and provider. Its glue's
 * C functions are `lucent_widget_<extension>_…`, the same way.
 */
export function widgetName(extension: string): string {
  return extension.replace(/-/g, "_");
}
