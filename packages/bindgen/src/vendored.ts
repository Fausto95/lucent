/**
 * Prebuilt frameworks packages ship: where the simulator build finds each,
 * so bindings read the same declarations the app links.
 */
import fs from "node:fs";
import path from "node:path";

/** One `AvailableLibraries` entry of an XCFramework's Info.plist. */
interface Library {
  identifier?: string;
  path?: string;
  platform?: string;
  variant?: string;
}

/**
 * The framework search path of a `.framework` (its directory) or of an
 * `.xcframework` (its iOS simulator slice); none when it has no such slice.
 */
export function frameworkSearchPath(framework: string): string | undefined {
  if (!framework.endsWith(".xcframework")) return path.dirname(framework);

  const slice = xcframeworkLibraries(framework).find(
    (l) => l.platform === "ios" && l.variant === "simulator" && l.identifier && l.path,
  );

  if (!slice) return undefined;

  const dir = path.join(framework, slice.identifier!);

  return fs.existsSync(path.join(dir, slice.path!)) ? dir : undefined;
}

/** The slices an XCFramework's (XML) Info.plist lists. */
function xcframeworkLibraries(framework: string): Library[] {
  const plist = path.join(framework, "Info.plist");

  if (!fs.existsSync(plist)) return [];

  const text = fs.readFileSync(plist, "utf8");
  const start = /<key>AvailableLibraries<\/key>\s*<array>/.exec(text);

  if (!start) return [];

  // The array ends at its own </array>: its entries hold arrays (SupportedArchitectures) too.
  const tags = /<(\/?)array>/g;
  tags.lastIndex = start.index + start[0].length;

  let end = text.length;
  for (let depth = 1, m = tags.exec(text); m; m = tags.exec(text)) {
    depth += m[1] ? -1 : 1;

    if (depth === 0) {
      end = m.index;
      break;
    }
  }

  const libraries = text.slice(start.index + start[0].length, end);

  return [...libraries.matchAll(/<dict>([\s\S]*?)<\/dict>/g)].map(([, entry]) => {
    const value = (key: string) =>
      new RegExp(`<key>${key}</key>\\s*<string>([^<]*)</string>`).exec(entry!)?.[1];

    return {
      identifier: value("LibraryIdentifier"),
      path: value("LibraryPath"),
      platform: value("SupportedPlatform"),
      variant: value("SupportedPlatformVariant"),
    };
  });
}
