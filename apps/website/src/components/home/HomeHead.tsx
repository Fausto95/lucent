import Head from "@docusaurus/Head";
import { SITE } from "@site/src/blog/meta";

const title = "Lucent — native logic and views in TypeScript";

const description =
  "Native logic and views for React Native, written in TypeScript. Compile functions to C++ and write SwiftUI and Jetpack Compose bodies in JSX.";

/** The homepage's title, description, link-preview tags, icon and feed. */
export function HomeHead() {
  return (
    <Head>
      <title>{title}</title>
      <meta name="description" content={description} />
      <link rel="canonical" href={SITE} />
      <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
      <link rel="alternate" type="application/rss+xml" title="Lucent blog" href="/blog/rss.xml" />
      <meta property="og:title" content={title} />
      <meta property="og:description" content={description} />
      <meta property="og:type" content="website" />
      <meta property="og:url" content={SITE} />
      <meta property="og:image" content={`${SITE}/og.png`} />
      <meta name="twitter:card" content="summary_large_image" />
    </Head>
  );
}
