# @lucent-lang/language-server

Language service stub for Lucent (roadmap P67–P71).

A full Language Server Protocol implementation — autocomplete, rename, ownership
hints, native signature preview — is **post-MVP**. This package shares the
compiler resolver (`compile()` / `parseModule()` from `@lucent-lang/compiler`)
so editor tooling and the CLI diagnose with the same rules.

## API

```ts
import { createLanguageService } from "@lucent-lang/language-server";

const ls = createLanguageService({ libraries: {/* optional LibraryModule map */} });

const diagnostics = ls.diagnose(source, "app.lucent.ts");
const hover = ls.hoverSymbol(source, "app.lucent.ts", offset); // "name: type" or null
const def = ls.gotoDefinition(source, "app.lucent.ts", offset); // { fileName, start, end } | null
const refs = ls.findReferences(source, "app.lucent.ts", offset); // SourceLocation[]
```

## Stdio stub

```bash
pnpm exec tsx packages/language-server/src/index.ts
# JSON lines: { "method": "diagnose"|"hover"|"gotoDefinition"|"findReferences", ... }
```

## Status

| Feature                              | Status                                        |
| ------------------------------------ | --------------------------------------------- |
| Diagnostics via `compile()`          | Implemented                                   |
| Hover                                | Name + type via `compile()`                   |
| Go to definition                     | Local functions + import bindings (file+span) |
| Find references                      | Within-module name occurrences                |
| Autocomplete, rename                 | Not started                                   |
| Generated native preview (P71)       | Not started                                   |
| Ownership / executor IDE hints (P69) | Not started                                   |
