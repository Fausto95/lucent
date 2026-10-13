/**
 * The Java name of a Lucent class the OS makes on Android (decision 0097):
 * `dev.lucent.app.<module>.<Class>`. The module's name (`<package>/<path>`)
 * becomes package segments, every character but letters and digits `_`,
 * and a segment Java would refuse gets a `_` in front. Without TypeScript:
 * lucent.json's components name classes by it.
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
