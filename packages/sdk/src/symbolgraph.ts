import { createHash } from "node:crypto";
import { validateSDKSchema, type SDKFunction, type SDKSchema } from "./schema.ts";
export const SYMBOL_GRAPH_EXTRACTOR_VERSION = 1;
type ObjectData = Record<string, unknown>;
const object = (value: unknown): value is ObjectData => !!value && typeof value === "object" && !Array.isArray(value);
interface Fragment {
  kind: string;
  spelling: string;
}
function fragments(value: unknown): Fragment[] {
  if (
    !Array.isArray(value) ||
    !value.every((f) => object(f) && typeof f.kind === "string" && typeof f.spelling === "string")
  )
    throw new Error("Malformed declaration fragments");
  return value as Fragment[];
}
const identifier = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Za-z_][A-Za-z0-9_]*$/.test(value);

/** Structured, fail-closed adapter for Swift compiler symbol graph format 0.6. */
export function extractSwiftSymbolGraph(source: string): SDKSchema {
  const graph: unknown = JSON.parse(source);
  if (
    !object(graph) ||
    !object(graph.metadata) ||
    !object(graph.module) ||
    !identifier(graph.module.name) ||
    !Array.isArray(graph.symbols)
  )
    throw new Error("Invalid Swift symbol graph");
  const version = graph.metadata.formatVersion;
  if (!object(version) || version.major !== 0 || version.minor !== 6)
    throw new Error("Unsupported Swift symbol graph version; expected 0.6");
  const schema: SDKSchema = {
    version: 1,
    platform: "ios",
    module: graph.module.name,
    functions: [],
    diagnostics: [],
    coverage: [],
    extraction: {
      adapter: "swift-symbolgraph",
      version: SYMBOL_GRAPH_EXTRACTOR_VERSION,
      inputHash: createHash("sha256").update(source).digest("hex"),
      generator: String(graph.metadata.generator ?? "unknown"),
      format: "0.6",
      platform: graph.module.platform,
    },
  };
  const seen = new Set<string>();
  for (const raw of graph.symbols) {
    if (
      !object(raw) ||
      !object(raw.identifier) ||
      typeof raw.identifier.precise !== "string" ||
      !object(raw.kind) ||
      typeof raw.kind.identifier !== "string"
    )
      throw new Error("Malformed Swift symbol identity");
    const symbolId = raw.identifier.precise;
    if (seen.has(symbolId)) throw new Error(`Duplicate Swift symbol identity ${symbolId}`);
    seen.add(symbolId);
    const kind = raw.kind.identifier;
    const name = object(raw.names) && typeof raw.names.title === "string" ? raw.names.title : symbolId;
    const entry = { symbolId, name, kind };
    try {
      if (raw.accessLevel !== "public" && raw.accessLevel !== "open") throw new Error("Non-public declaration");
      if (kind !== "swift.func" || !Array.isArray(raw.pathComponents) || raw.pathComponents.length !== 1)
        throw new Error(`Unsupported symbol kind ${kind}`);
      if (raw.swiftGenerics !== undefined) throw new Error("Generic specialization requires an explicit overlay");
      if (raw.availability !== undefined) throw new Error("SDK availability requires an explicit overlay");
      const declaration = fragments(raw.declarationFragments);
      if (
        declaration.some(
          (f) => f.kind === "attribute" || ["async", "rethrows", "isolated", "nonisolated"].includes(f.spelling),
        )
      )
        throw new Error("Unsupported native effect or executor annotation");
      const functionName = declaration.find((f) => f.kind === "identifier")?.spelling;
      if (!identifier(functionName)) throw new Error("Unsupported function name");
      const signature = raw.functionSignature;
      if (!object(signature) || !Array.isArray(signature.parameters))
        throw new Error("Missing structured function signature");
      const labels = declaration.filter((f) => f.kind === "externalParam").map((f) => f.spelling);
      if (labels.length !== signature.parameters.length) throw new Error("Incomplete parameter labels");
      const parameters = signature.parameters.map((parameter, i) => {
        if (!object(parameter) || !identifier(parameter.name) || (labels[i] !== "_" && !identifier(labels[i])))
          throw new Error("Unsupported parameter name");
        const text = fragments(parameter.declarationFragments)
          .map((f) => f.spelling)
          .join("");
        const type = /^[A-Za-z_][A-Za-z0-9_]*\s*:\s*([A-Za-z_][A-Za-z0-9_.]*)$/.exec(text)?.[1];
        if (!type) throw new Error("Unsupported parameter type or ownership annotation");
        return { name: parameter.name, label: labels[i]!, nativeType: type };
      });
      const fn: SDKFunction = {
        name: functionName,
        nativeName: `${schema.module}.${functionName}`,
        nativeId: symbolId,
        parameters,
        returnType: fragments(signature.returns)
          .map((f) => f.spelling)
          .join(""),
        throws: declaration.some((f) => f.spelling === "throws"),
      };
      const validated = validateSDKSchema({ ...schema, functions: [fn], diagnostics: [] });
      if (!validated.functions.length) throw new Error(validated.diagnostics.join("; "));
      schema.functions.push(fn);
      schema.coverage!.push({ ...entry, status: "supported" });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      schema.coverage!.push({ ...entry, status: "skipped", reason });
      schema.diagnostics.push(`Skipped ${name} (${symbolId}): ${reason}`);
    }
  }
  schema.functions.sort((a, b) => (a.nativeId ?? a.name).localeCompare(b.nativeId ?? b.name));
  schema.coverage!.sort((a, b) => a.symbolId.localeCompare(b.symbolId));
  return schema;
}
