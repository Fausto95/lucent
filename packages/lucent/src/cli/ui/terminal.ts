/** What the output can use: decided once, from the environment and the stream. */
export interface Terminal {
  /** ANSI colours. */
  color: boolean;
  /** Spinners, live views and prompts. */
  interactive: boolean;
  /** Unicode symbols; ASCII otherwise. */
  unicode: boolean;
  /** OSC 8 hyperlinks. */
  links: boolean;
  /** Columns to fit, at most 120. */
  width: number;
}

type Env = Record<string, string | undefined>;

// Terminals known to render OSC 8 hyperlinks (others print the escape codes).
const LINK_TERMINALS = new Set(["iTerm.app", "WezTerm", "vscode", "ghostty", "Hyper", "Tabby", "rio"]);

export function detectTerminal(env: Env, stream: { isTTY?: boolean; columns?: number }, platform: NodeJS.Platform = process.platform): Terminal {
  const tty = !!stream.isTTY;
  const dumb = env.TERM === "dumb";
  const forced = env.FORCE_COLOR;
  const color = env.NO_COLOR ? false : forced !== undefined && forced !== "" ? forced !== "0" && forced !== "false" : tty && !dumb;
  const interactive = tty && !dumb && !env.CI;
  const unicode = !dumb && (platform !== "win32" || !!env.WT_SESSION || env.TERM_PROGRAM === "vscode");
  const links = interactive && color && (LINK_TERMINALS.has(env.TERM_PROGRAM ?? "") || !!env.WT_SESSION || Number(env.VTE_VERSION ?? 0) >= 5000);
  return { color, interactive, unicode, links, width: Math.min(stream.columns || 80, 120) };
}
