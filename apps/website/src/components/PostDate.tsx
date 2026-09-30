import * as stylex from "@stylexjs/stylex";
import { formatDate } from "../blog/types";
import { styles } from "./Blog.stylex";

/** When a post was published, readable, with the machine-readable date beside it. */
export function PostDate({ date }: { date: string }) {
  return (
    <time dateTime={date} {...stylex.props(styles.date)}>
      {formatDate(date)}
    </time>
  );
}
