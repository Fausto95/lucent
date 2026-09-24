import { useLocation } from "@tanstack/react-router";
import { useEffect } from "react";

/**
 * Scrolls to the element named by the URL hash once the page content exists.
 * Needed because docs content renders after the initial document load, so the
 * browser's own hash scrolling finds nothing.
 */
export function useScrollToHash(dependency: unknown): void {
  const hash = useLocation({ select: (location) => location.hash });
  useEffect(() => {
    if (!hash) return;
    const frame = requestAnimationFrame(() => {
      document.getElementById(hash)?.scrollIntoView({ block: "start" });
    });
    return () => cancelAnimationFrame(frame);
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- scroll again once the content that holds the target renders
  }, [hash, dependency]);
}
