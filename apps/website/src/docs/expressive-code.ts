import type { ExpressiveCodePlugin } from "@astrojs/starlight/expressive-code";

/**
 * `nocopy` in a fence's meta: output to read, not to run, such as a
 * terminal's (markdown.ts). The block keeps its frame, without the copy button.
 */
export function pluginNoCopy(): ExpressiveCodePlugin {
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
