// statusBar.lucent.ts's web twin: a browser draws no status bar over the page.

/** In density-independent pixels: always 0 on the web. */
export function statusBarHeight(): number {
  return 0;
}
