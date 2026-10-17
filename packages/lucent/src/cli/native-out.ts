import path from "node:path";

/**
 * Where the native package is: `out` (`lucent build --out`), else the one
 * LUCENT_OUT names, both relative to the project, else its .lucent/native.
 * Every tool that reads or writes the package agrees: this for the CLI,
 * metro/native-package.cjs for Metro, autolinking and the Expo plugin.
 */
export function nativeOut(root: string, out?: string): string {
  return path.resolve(root, out || process.env.LUCENT_OUT || path.join(".lucent", "native"));
}
