import type { OptionSpecs, Values } from "../args.ts";
import type { GlyphName } from "../emoji.ts";
import type { IO } from "../io.ts";
import type { UI } from "../ui.ts";

export interface CommandContext {
  root: string;
  io: IO;
  ui: UI;
}

export interface Example {
  command: string;
  note: string;
}

/** A command is data plus one `run`. Help, parsing and suggestions derive from the data. */
export interface Command<S extends OptionSpecs = OptionSpecs> {
  readonly name: string;
  readonly glyph: GlyphName;
  readonly summary: string;
  /** Everything after `lucent <name>` in the usage line. */
  readonly usage: string;
  readonly options: S;
  readonly examples: readonly Example[];
  /** Owns its own argument parsing and receives argv untouched. */
  readonly raw?: boolean;
  run(context: CommandContext, values: Values<S>, positionals: string[]): Promise<number>;
}

export const defineCommand = <S extends OptionSpecs>(command: Command<S>): Command<S> => command;
