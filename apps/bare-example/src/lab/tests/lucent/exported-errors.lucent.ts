export class ParseError extends Error {
  constructor(
    message: string,
    readonly line: number,
  ) {
    super(message);
    this.name = "ParseError";
  }
}

export class TokenError extends ParseError {
  constructor(readonly token: string) {
    super(`unexpected ${token}`, 1);
    this.name = "TokenError";
  }
}

export function parse(line: number): ParseError {
  return new ParseError(`bad line ${line}`, line);
}

export function asError(line: number): Error {
  return new ParseError(`as error ${line}`, line);
}

export function fail(line: number): number {
  throw new ParseError(`failed at ${line}`, line);
}

export function failToken(token: string): number {
  throw new TokenError(token);
}

export async function later(line: number): Promise<number> {
  throw new ParseError(`later ${line}`, line);
}

export function raise(e: ParseError): void {
  throw e;
}

export function describe(e: ParseError): string {
  return `${e.name}: ${e.message} @${e.line}`;
}

export function kind(e: Error): string {
  if (e instanceof TokenError) return `token ${e.token}`;
  if (e instanceof ParseError) return `parse ${e.line}`;
  return `error ${e.message}`;
}
