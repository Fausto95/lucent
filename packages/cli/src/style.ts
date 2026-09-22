/** ANSI styling with the standard opt-outs. Pure: callers pass env and tty state. */
const ESC = String.fromCharCode(27);

const CODES = {
  bold: [1, 22],
  dim: [2, 22],
  underline: [4, 24],
  red: [31, 39],
  green: [32, 39],
  yellow: [33, 39],
  blue: [34, 39],
  magenta: [35, 39],
  cyan: [36, 39],
  gray: [90, 39],
} as const;

export type StyleName = keyof typeof CODES;
export type Style = (text: string) => string;
export type Palette = Readonly<Record<StyleName, Style>>;

export interface ColorInput {
  env: Readonly<Record<string, string | undefined>>;
  isTTY: boolean;
  /** An explicit --color / --no-color; undefined means "decide from the environment". */
  flag?: boolean;
}

/** Precedence: explicit flag, FORCE_COLOR, NO_COLOR, TERM=dumb, CI, then the tty. */
export function supportsColor({ env, isTTY, flag }: ColorInput): boolean {
  if (flag !== undefined) return flag;
  if (env.FORCE_COLOR !== undefined) return !["0", "false"].includes(env.FORCE_COLOR);
  if (env.NO_COLOR) return false;
  if (env.TERM === "dumb") return false;
  if (env.CI) return true;
  return isTTY;
}

export function createPalette(enabled: boolean): Palette {
  const entries = Object.entries(CODES).map(([name, [open, close]]): [string, Style] => [
    name,
    enabled ? (text) => `${ESC}[${open}m${text}${ESC}[${close}m` : (text) => text,
  ]);
  return Object.fromEntries(entries) as Palette;
}

const ANSI_PATTERN = new RegExp(`${ESC}\\[\\d+m`, "g");

export const stripAnsi = (text: string): string => text.replaceAll(ANSI_PATTERN, "");
