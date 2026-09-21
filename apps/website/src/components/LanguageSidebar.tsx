import * as stylex from "@stylexjs/stylex";
import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { styles } from "./LanguageSidebar.stylex";

const sections = [
  { id: "overview", title: "Overview" },
  { id: "modules", title: "Modules & functions" },
  { id: "types", title: "Types" },
  { id: "control-flow", title: "Control flow" },
  { id: "expressions", title: "Expressions" },
  { id: "async-errors", title: "Async & errors" },
  { id: "semantics", title: "Runtime semantics" },
  { id: "diagnostics", title: "Diagnostics" },
];

export function LanguageSidebar() {
  const [active, setActive] = useState("overview");
  useEffect(() => {
    let frame: number | null = null;
    const update = () => {
      const current = sections
        .filter((section) => (document.getElementById(section.id)?.getBoundingClientRect().top ?? Infinity) <= 140)
        .at(-1);
      setActive(current?.id ?? "overview");
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
  }, []);
  return (
    <aside {...stylex.props(styles.referenceSidebar)}>
      <nav aria-label="Language sections" {...stylex.props(styles.referenceNav)}>
        <p {...stylex.props(styles.eyebrow4)}>LANGUAGE REFERENCE</p>
        {sections.map((section, index) => (
          <Link
            key={section.id}
            to="/language/"
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
      <div {...stylex.props(styles.referenceVersion)}>
        <span {...stylex.props(styles.referenceVersionNumber)}>v1</span> Language contract
      </div>
    </aside>
  );
}
