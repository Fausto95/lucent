/** A card that links to a page: its title, and one line on what it holds. */
import Link from "@docusaurus/Link";

interface Props {
  title: string;
  description?: string;
  href: string;
}

export default function LinkCard({ title, description, href }: Props) {
  return (
    <Link className="lucent-link-card" to={href}>
      <span className="title">{title}</span>
      {description && <span className="description">{description}</span>}
    </Link>
  );
}
