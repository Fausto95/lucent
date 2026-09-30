/** Words TypeScript reserves, which cannot name what an extension declares for Lucent code. */
export const TS_RESERVED: ReadonlySet<string> = new Set(
  "break case catch class const continue debugger default delete do else enum export extends false finally for function if import in instanceof new null return super switch this throw true try typeof var void while with yield let static implements interface package private protected public await".split(
    " ",
  ),
);
