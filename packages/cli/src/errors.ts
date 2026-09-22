/** The one error commands throw. The dispatcher renders it once and exits with `exitCode`. */
export class CliError extends Error {
  readonly hint: string | undefined;
  readonly exitCode: number;

  constructor(message: string, options: { hint?: string; exitCode?: number } = {}) {
    super(message);
    this.name = "CliError";
    this.hint = options.hint;
    this.exitCode = options.exitCode ?? 1;
  }
}
