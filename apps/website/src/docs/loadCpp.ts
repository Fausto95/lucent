import { type CppFile, type CppModule } from "./types";

// A page's C++ is its own chunk, fetched when a reader opens "See the C++".
const modules = import.meta.glob<CppModule>("../generated/cpp/**/*.ts");

export async function loadCpp(slug: string, filename: string): Promise<CppFile[]> {
  const load = modules[`../generated/cpp/${slug || "index"}.ts`];
  const files = load && (await load()).cpp[filename];
  if (!files?.length)
    throw new Error(`/docs/${slug}/ has no C++ for ${filename}: run scripts/website.ts`);
  return files;
}
