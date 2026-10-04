/**
 * Code blocks: Expressive Code, configured as the site had it under
 * Starlight with the Six theme, so they look the same: GitHub's themes,
 * frames with the file's title, Lucent's fonts and sizes. Docusaurus marks
 * the color mode on <html data-theme="dark|light">, the attribute these
 * styles select on.
 */
import type { ExpressiveCodePlugin, RehypeExpressiveCodeOptions } from "rehype-expressive-code";

/** The copy button's icon (Six's). */
const copyIcon = `url("data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="8" height="4" x="8" y="2" rx="1" ry="1"></rect><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path></svg>',
)}")`;

/**
 * `nocopy` in a fence's meta: output to read, not to run, such as a
 * terminal's (markdown.ts). The block keeps its frame, without the copy button.
 */
function pluginNoCopy(): ExpressiveCodePlugin {
  return {
    name: "lucent-nocopy",
    baseStyles: ".nocopy .copy { display: none; }",
    hooks: {
      postprocessRenderedBlock: ({ codeBlock, renderData }) => {
        if (!codeBlock.metaOptions.getBoolean("nocopy")) return;
        const props = renderData.blockAst.properties;
        const classes = Array.isArray(props.className) ? props.className : [];
        props.className = [...classes, "nocopy"];
      },
    },
  };
}

export const expressiveCode: RehypeExpressiveCodeOptions = {
  themes: ["github-dark-default", "github-light-default"],
  themeCssSelector: (theme) => `[data-theme='${theme.type}']`,
  useDarkModeMediaQuery: false,
  frames: { extractFileNameFromCode: false },
  styleOverrides: {
    borderRadius: "calc(var(--lucent-radius) + 4px)",
    borderWidth: "0px",
    codePaddingBlock: "0.75rem",
    codePaddingInline: "1rem",
    codeFontFamily: "var(--lucent-font-mono)",
    codeFontSize: "var(--lucent-text-code)",
    codeLineHeight: "1.75",
    uiFontFamily: "var(--lucent-font)",
    codeBackground: "var(--lucent-code-background)",
    gutterBorderWidth: "0px",
    frames: {
      editorBackground: "var(--lucent-code-background)",
      terminalBackground: "var(--lucent-code-background)",
      copyIcon,
      frameBoxShadowCssValue: "none",
    },
    textMarkers: {
      lineDiffIndicatorMarginLeft: "0.25rem",
      defaultChroma: "45",
      backgroundOpacity: "60%",
      markBackground: "var(--lucent-mark-background)",
      markBorderColor: "var(--lucent-border)",
    },
  },
  plugins: [pluginNoCopy()],
};
