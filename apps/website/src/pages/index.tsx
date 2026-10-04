import "@fontsource/geist/400.css";
import "@fontsource/geist/500.css";
import "@fontsource/geist/600.css";
import "@fontsource/geist/700.css";
import "@fontsource/geist-mono/400.css";
import "../css/home.css";
import LayoutProvider from "@theme/Layout/Provider";
import { BlogAnnouncement } from "../components/home/BlogAnnouncement";
import { Closing } from "../components/home/Closing";
import { Compatibility } from "../components/home/Compatibility";
import { Faq } from "../components/home/Faq";
import { Hero } from "../components/home/Hero";
import { HomeFooter } from "../components/home/HomeFooter";
import { HomeHead } from "../components/home/HomeHead";
import { HomeNav } from "../components/home/HomeNav";
import { HowItComesTogether } from "../components/home/HowItComesTogether";
import { SupportStrip } from "../components/home/SupportStrip";
import { ViewsShowcase } from "../components/home/ViewsShowcase";

/**
 * The homepage, with its own header and footer: the theme's providers (color
 * mode among them) without the docs' navbar and footer.
 */
export default function Home() {
  return (
    <LayoutProvider>
      <HomeHead />
      <div id="voltage-home">
        <a className="skip-link" href="#main-content">
          Skip to content
        </a>
        <HomeNav />
        <BlogAnnouncement />

        <main id="main-content">
          <Hero />
          <SupportStrip />
          <ViewsShowcase />
          <HowItComesTogether />
          <Compatibility />
          <Faq />
          <Closing />
        </main>

        <HomeFooter />
      </div>
    </LayoutProvider>
  );
}
