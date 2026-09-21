import * as stylex from "@stylexjs/stylex";
import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { styles } from "./LanguageSidebar.stylex";

export interface SidebarSection {
  id: string;
  title: string;
}

interface SectionSidebarProps {
  /** Route the hash links point at, e.g. `/language/`. */
  to: "/language/" | "/get-started/";
  label: string;
  sections: SidebarSection[];
  footer?: React.ReactNode;
}

/** Sticky in-page navigation that highlights the section currently scrolled into view. */
export function SectionSidebar({ to, label, sections, footer }: SectionSidebarProps) {
  const first = sections[0]?.id ?? "";
  const [active, setActive] = useState(first);
  useEffect(() => {
    let frame: number | null = null;
    const update = () => {
      const current = sections
        .filter((section) => (document.getElementById(section.id)?.getBoundingClientRect().top ?? Infinity) <= 140)
        .at(-1);
      setActive(current?.id ?? first);
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
  }, [sections, first]);
  return (
    <aside {...stylex.props(styles.referenceSidebar)}>
      <nav aria-label={`${label} sections`} {...stylex.props(styles.referenceNav)}>
        <p {...stylex.props(styles.eyebrow4)}>{label.toUpperCase()}</p>
        {sections.map((section, index) => (
          <Link
            key={section.id}
            to={to}
            hash={section.id}
            aria-current={active === section.id ? "location" : undefined}
            {...stylex.props(styles.referenceNavLink, active === section.id && styles.activeSection)}
          >
            <span {...stylex.props(styles.referenceNavNumber)}>{String(index).padStart(2, "0")}</span>
            {section.title}
          </Link>
        ))}
      </nav>
      <Link to="/" {...stylex.props(styles.referenceBack)}>
        ← Back to Lucent
      </Link>
      {footer}
    </aside>
  );
}
