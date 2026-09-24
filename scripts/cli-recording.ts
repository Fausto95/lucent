/**
 * Records the README's terminal animation (assets/cli.svg): runs the real
 * CLI on a sample project (lucent build, then an error and lucent check),
 * keeps its coloured output and when each chunk arrived, and renders the
 * session as an animated SVG: each command typed out, its output shown as
 * it came, one screen per command, looping.
 *
 *   node scripts/cli-recording.ts
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bin = path.join(root, "packages/lucent/bin/lucent.cjs");
const app = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-recording-"));
fs.mkdirSync(path.join(app, "src"));
const geo = path.join(app, "src/geo.lucent.ts");
const good = `export type Point = { x: number; y: number };

export function squaredDistance(a: Point, b: Point): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}
`;
fs.writeFileSync(geo, good);

type Chunk = { at: number; text: string };
type Screen = { command: string; chunks: Chunk[] };

/** Runs `lucent <args>` with colours on, recording its output and when it came. */
function record(args: string[]): Promise<Chunk[]> {
  return new Promise((resolve) => {
    const start = Date.now();
    const chunks: Chunk[] = [];
    const child = spawn(process.execPath, [bin, ...args, "--root", app], {
      env: { ...process.env, FORCE_COLOR: "1", COLUMNS: "78" },
    });
    const add = (d: Buffer) => chunks.push({ at: Date.now() - start, text: d.toString() });
    child.stdout.on("data", add);
    child.stderr.on("data", add);
    child.on("close", () => resolve(chunks));
  });
}

const screens: Screen[] = [];
// Warm the caches first: the recording shows a normal build, not a first one.
await record(["build"]);
fs.rmSync(path.join(app, ".lucent"), { recursive: true, force: true });
screens.push({ command: "npx lucent build", chunks: await record(["build"]) });
fs.writeFileSync(geo, good.replace("const dx", "var dx"));
screens.push({ command: "npx lucent check", chunks: await record(["check"]) });
fs.rmSync(app, { recursive: true, force: true });

// --- rendering ---------------------------------------------------------------------

const PALETTE: Record<string, string> = {
  31: "#ff6b6b",
  32: "#7ee787",
  33: "#f2cc60",
  36: "#79c0ff",
  90: "#8b949e",
};
const VIOLET = "#b392f0";
const FG = "#e6edf3";
type Style = { fill: string; bold: boolean; dim: boolean };
type Span = { text: string; style: Style };

/** A line of ANSI-coloured text as styled spans (SGR only: colours, bold, dim). */
function spans(line: string, style: Style): { spans: Span[]; style: Style } {
  const out: Span[] = [];
  let s = { ...style };
  for (const part of line.split(/(\x1b\[[0-9;]*m)/)) {
    const m = /^\x1b\[([0-9;]*)m$/.exec(part);
    if (!m) {
      if (part) out.push({ text: part, style: { ...s } });
      continue;
    }
    const codes = m[1]!.split(";");
    for (let i = 0; i < codes.length; i++) {
      const c = codes[i]!;
      if (c === "0" || c === "") s = { fill: FG, bold: false, dim: false };
      else if (c === "1") s.bold = true;
      else if (c === "2") s.dim = true;
      else if (c === "22") ((s.bold = false), (s.dim = false));
      else if (c === "39") s.fill = FG;
      else if (c === "38" && codes[i + 1] === "5")
        ((s.fill = codes[i + 2] === "141" ? VIOLET : FG), (i += 2));
      else if (PALETTE[c]) s.fill = PALETTE[c]!;
    }
  }
  return { spans: out, style: s };
}

const escape = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const LINE = 19;
const TOP = 44;
const LEFT = 18;
const TYPE_MS = 45;
const HOLD_MS = 3500;

// Timeline: type the command, show output at its recorded pace (long pauses shortened), hold, next screen.
type Timed = { at: number; screen: number; y: number; spans: Span[] };
const lines: Timed[] = [];
const windows: { from: number; to: number }[] = [];
let clock = 400;
let maxLines = 0;
screens.forEach((screen, index) => {
  const from = clock;
  const prompt: Span[] = [{ text: "$ ", style: { fill: "#8b949e", bold: false, dim: false } }];
  let typed = "";
  for (const ch of screen.command) {
    typed += ch;
    lines.push({
      at: clock,
      screen: index,
      y: 0,
      spans: [...prompt, { text: typed, style: { fill: FG, bold: true, dim: false } }],
    });
    clock += TYPE_MS;
  }
  clock += 300;
  const start = clock;
  let row = 1;
  let style: Style = { fill: FG, bold: false, dim: false };
  let pending = "";
  let last = 0;
  for (const chunk of screen.chunks) {
    const at = start + Math.min(chunk.at - last, 700) + (last ? lines.at(-1)!.at - start : 0);
    last = chunk.at;
    pending += chunk.text;
    const parts = pending.split("\n");
    pending = parts.pop()!;
    for (const text of parts) {
      const r = spans(text, style);
      style = r.style;
      lines.push({ at, screen: index, y: row++, spans: r.spans });
    }
  }
  if (pending)
    lines.push({
      at: lines.at(-1)?.at ?? start,
      screen: index,
      y: row++,
      spans: spans(pending, style).spans,
    });
  maxLines = Math.max(maxLines, row);
  clock = (lines.at(-1)?.at ?? clock) + HOLD_MS;
  windows.push({ from, to: clock });
});
const total = clock + 400;

// Only the last typed state of the prompt stays: earlier ones hide when the next appears.
const width = 700;
const height = TOP + maxLines * LINE + 16;
const pct = (ms: number) => ((100 * ms) / total).toFixed(3);
const css: string[] = [];
const texts: string[] = [];
lines.forEach((l, i) => {
  const next = lines[i + 1];
  const replaced = next && next.screen === l.screen && next.y === l.y ? next.at : undefined;
  const end = replaced ?? windows[l.screen]!.to;
  css.push(
    `@keyframes k${i}{0%,${pct(l.at - 1)}%{opacity:0}${pct(l.at)}%,${pct(end - 1)}%{opacity:1}${pct(end)}%,100%{opacity:0}}#l${i}{animation:k${i} ${total}ms step-end infinite}`,
  );
  const tspans = l.spans
    .map(
      (s) =>
        `<tspan fill="${s.style.fill}"${s.style.bold ? ' font-weight="700"' : ""}${s.style.dim ? ' opacity="0.6"' : ""}>${escape(s.text)}</tspan>`,
    )
    .join("");
  texts.push(
    `<text id="l${i}" x="${LEFT}" y="${TOP + l.y * LINE}" xml:space="preserve">${tspans}</text>`,
  );
});

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="lucent build, then lucent check reporting an error with a code frame and its fix">
<style>text{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:13.5px;opacity:0}${css.join("")}</style>
<rect width="${width}" height="${height}" rx="10" fill="#0d1117"/>
<circle cx="20" cy="18" r="6" fill="#ff5f57"/><circle cx="40" cy="18" r="6" fill="#febc2e"/><circle cx="60" cy="18" r="6" fill="#28c840"/>
${texts.join("\n")}
</svg>
`;
const outFile = path.join(root, "assets/cli.svg");
fs.writeFileSync(outFile, svg);
console.log(
  `✓ ${path.relative(root, outFile)}: ${screens.length} screens, ${(total / 1000).toFixed(1)} s, ${(svg.length / 1024).toFixed(0)} KB`,
);
