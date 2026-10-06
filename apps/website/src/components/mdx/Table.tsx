/**
 * A Markdown table in a box of its own: the box draws the frame and scrolls
 * a wide table sideways, so the table itself can fill the column.
 */
import type { ComponentProps } from "react";

export default function Table(props: ComponentProps<"table">) {
  return (
    <div className="lucent-table">
      <table {...props} />
    </div>
  );
}
