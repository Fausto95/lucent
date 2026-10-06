import Link from "@docusaurus/Link";

/** The wordmark, linking home: the header's and the footer's. */
export function Logo() {
  return (
    <Link className="logo" to="/" aria-label="Lucent home">
      <span className="mark" />
      lucent
    </Link>
  );
}
