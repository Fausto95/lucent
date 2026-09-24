import * as stylex from "@stylexjs/stylex";
import type { ReactNode } from "react";
import { styles } from "../pages/HomePage.stylex";
import { SmartLink } from "./SmartLink";

interface FeatureCardProps {
  number: string;
  /** SVG children for a 32×32 viewBox; stroked with the accent colour. */
  icon: ReactNode;
  title: string;
  text: string;
  href: string;
  linkLabel: string;
  /** Column position; the last column has no right border. */
  position: "first" | "middle" | "last";
}

const positionStyles = { first: styles.article, middle: styles.article2, last: styles.article3 };

/** One numbered feature in the homepage's three-column grids. */
export function FeatureCard({
  number,
  icon,
  title,
  text,
  href,
  linkLabel,
  position,
}: FeatureCardProps) {
  return (
    <article {...stylex.props(positionStyles[position])}>
      <div {...stylex.props(styles.featureTop)}>
        <span {...stylex.props(styles.featureNumber)}>{number}</span>
        <svg viewBox="0 0 32 32" aria-hidden="true" {...stylex.props(styles.featureIcon)}>
          {icon}
        </svg>
      </div>
      <h3 {...stylex.props(styles.featureHeading)}>{title}</h3>
      <p {...stylex.props(styles.featureDescription)}>{text}</p>
      <SmartLink href={href} {...stylex.props(styles.featureLink)}>
        {linkLabel} <span aria-hidden="true">↗</span>
      </SmartLink>
    </article>
  );
}
