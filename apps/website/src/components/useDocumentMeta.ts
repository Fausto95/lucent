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

/**
 * The single writer of <title>, description and the Open Graph mirrors, per
 * page; `image` is the page's preview under public/, else the site's.
 */
export function useDocumentMeta(title: string, description: string, image = "/og.png"): void {
  useEffect(() => {
    document.title = title;
    const url = `${window.location.origin}${image}`;
    setMeta("name", "description", description);
    setMeta("property", "og:title", title);
    setMeta("property", "og:description", description);
    setMeta("property", "og:url", window.location.href);
    setMeta("property", "og:image", url);
    setMeta("name", "twitter:title", title);
    setMeta("name", "twitter:description", description);
    setMeta("name", "twitter:image", url);
  }, [title, description, image]);
}
