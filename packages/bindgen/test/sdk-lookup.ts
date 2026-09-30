/**
 * One SDK module lookup in its own process, as a build or a prefetch does:
 * `node sdk-lookup.ts <platform> <module> <options as JSON>`. Prints how
 * many modules this process extracted and what it found.
 */
import { extractionCount, sdkModule } from "../src/provider.ts";
import type { Platform } from "../src/schema.ts";

const [platform, module, opts] = process.argv.slice(2);
const found = sdkModule(platform as Platform, module!, JSON.parse(opts!));

process.stdout.write(JSON.stringify({ extracted: extractionCount(), found }));
