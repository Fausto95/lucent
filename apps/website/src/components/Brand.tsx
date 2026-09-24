import * as stylex from "@stylexjs/stylex";
import { Link } from "@tanstack/react-router";
import { styles } from "./Brand.stylex";

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <Link
      to="/"
      aria-label="Lucent home"
      {...stylex.props(styles.brand, compact && styles.compact)}
    >
      <img
        src="/brand/lucent-mark.svg"
        width="40"
        height="40"
        alt=""
        aria-hidden="true"
        {...stylex.props(styles.mark, compact && styles.compactMark)}
      />
      <span>
        lucent<span {...stylex.props(styles.period)}>.</span>
      </span>
    </Link>
  );
}
