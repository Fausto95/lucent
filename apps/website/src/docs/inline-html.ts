/** The docs inline markup (`code`, **strong**, [text](href)) as HTML, for components that show data. */
const escape = (text: string): string =>
  text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

const TOKEN = /(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\))/g;
const LINK = /^\[([^\]]+)\]\(([^)]+)\)$/;

export function inlineHtml(text: string): string {
  return text
    .split(TOKEN)
    .map((token) => {
      if (/^`[^`]+`$/.test(token)) return `<code>${escape(token.slice(1, -1))}</code>`;
      if (/^\*\*[^*]+\*\*$/.test(token))
        return `<strong>${inlineHtml(token.slice(2, -2))}</strong>`;
      const link = LINK.exec(token);
      if (link) return `<a href="${escape(link[2]!)}">${inlineHtml(link[1]!)}</a>`;
      return escape(token);
    })
    .join("");
}
