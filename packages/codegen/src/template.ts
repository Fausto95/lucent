/** Values substituted into a `{{token}}` placeholder in a native source file. */
export type NativeFill = Readonly<Record<string, string>>;

const TOKEN = /\{\{([A-Za-z][A-Za-z0-9]*)\}\}/g;

/**
 * Substitutes `{{token}}` placeholders in hand-written native source.
 *
 * Native files that need a host-supplied fragment stay real `.swift`/`.kt`
 * files with placeholders rather than becoming TypeScript template literals.
 * An unknown token is a build error: a silently empty hole would emit native
 * code that fails much later, in Xcode or Gradle.
 */
export function fillNative(template: string, values: NativeFill): string {
  return template.replace(TOKEN, (_, token: string) => {
    const value = values[token];
    if (value === undefined) throw new Error(`Unknown native template token {{${token}}}`);
    return value;
  });
}
