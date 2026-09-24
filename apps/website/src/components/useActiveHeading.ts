import { useEffect, useState } from "react";

/** Id of the last heading whose top has scrolled past the offset, for scroll-spy navigation. */
export function useActiveHeading(ids: string[], offset = 120): string | null {
  const [active, setActive] = useState<string | null>(null);
  useEffect(() => {
    let frame: number | null = null;
    const update = () => {
      const current = ids
        .filter(
          (id) => (document.getElementById(id)?.getBoundingClientRect().top ?? Infinity) <= offset,
        )
        .at(-1);
      setActive(current ?? null);
      frame = null;
    };
    const schedule = () => {
      if (frame === null) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [ids, offset]);
  return active;
}
