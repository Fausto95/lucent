import { useEffect } from "react";

function setMeta(attribute: "name" | "property", key: string, value: string): void {
  let element = document.head.querySelector<HTMLMetaElement>(`meta[${attribute}="${key}"]`);
  if (!element) {
    element = document.createElement("meta");
    element.setAttribute(attribute, key);
    document.head.append(element);
  }
  element.setAttribute("content", value);
}

/** The single writer of <title>, description and the Open Graph mirrors, per page. */
export function useDocumentMeta(title: string, description: string): void {
  useEffect(() => {
    document.title = title;
    const image = `${window.location.origin}/og.png`;
    setMeta("name", "description", description);
    setMeta("property", "og:title", title);
    setMeta("property", "og:description", description);
    setMeta("property", "og:url", window.location.href);
    setMeta("property", "og:image", image);
    setMeta("name", "twitter:title", title);
    setMeta("name", "twitter:description", description);
    setMeta("name", "twitter:image", image);
  }, [title, description]);
}
