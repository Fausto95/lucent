import Link from "@docusaurus/Link";
import { useState } from "react";
import { CodeSample } from "./CodeSample";
import { LikePreview } from "./LikePreview";
import { likeCompose, likeImport, likeLogic, likeSwiftUi } from "./samples";

const platforms = [
  { id: "swiftui", label: "SwiftUI", tokens: likeSwiftUi },
  { id: "compose", label: "Jetpack Compose", tokens: likeCompose },
] as const;

type Platform = (typeof platforms)[number]["id"];

/** Native views: one component's shared logic, each platform's body, and a live preview. */
export function ViewsShowcase() {
  const [shown, setShown] = useState<Platform>("swiftui");

  return (
    <section className="views-showcase wrap">
      <div className="views-title">
        <p className="kicker mono">NATIVE VIEWS / NOW IN LUCENT</p>
        <span className="experimental">EXPERIMENTAL</span>
      </div>
      <h2>
        TypeScript logic.
        <br />
        <span>Each platform’s own UI.</span>
      </h2>

      <div className="view-grid">
        <div className="view-code">
          <div className="code-label mono">
            <span>like.lucent.tsx</span>
            <span>EXCERPT</span>
          </div>
          <CodeSample tokens={likeLogic} />
          <div className="code-switch" role="group" aria-label="View code platform">
            {platforms.map((platform) => (
              <button
                key={platform.id}
                type="button"
                className="cursor-interaction"
                aria-pressed={shown === platform.id}
                aria-controls={`voltage-${platform.id}`}
                onClick={() => setShown(platform.id)}
              >
                {platform.label}
              </button>
            ))}
          </div>
          {platforms.map((platform) => (
            <CodeSample
              key={platform.id}
              id={`voltage-${platform.id}`}
              hidden={shown !== platform.id}
              tokens={platform.tokens}
            />
          ))}
        </div>

        <div className="view-demos">
          <div className="device">
            <span className="device-name">LIVE PREVIEW</span>
            <LikePreview />
            <small>One component. Each platform’s own UI.</small>
          </div>
          <div className="view-import">
            <div className="code-label mono">
              <span>ONE IMPORT IN REACT</span>
              <span>App.tsx</span>
            </div>
            <CodeSample tokens={likeImport} />
          </div>
          <p className="view-note">Tap the heart to try the interaction.</p>
        </div>
      </div>

      <div className="view-foot">
        <p className="bodycopy">
          Write the logic once. Write each platform’s body in JSX. Lucent generates C++ for the
          logic and Swift or Kotlin for the UI.
        </p>
        <Link className="textlink" to="/blog/native-views/">
          Meet native views ↗
        </Link>
      </div>
      <p className="view-note">Views are in preview. The API is experimental and may change.</p>
    </section>
  );
}
