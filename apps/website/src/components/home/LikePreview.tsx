import { useState } from "react";

/** The like button the views sample describes, working as it would on a device. */
export function LikePreview() {
  const [liked, setLiked] = useState(false);

  return (
    <button
      className="like-preview cursor-interaction"
      type="button"
      aria-label="Like"
      aria-pressed={liked}
      onClick={() => setLiked(!liked)}
    >
      <span className="heart" aria-hidden="true">
        {liked ? "♥" : "♡"}
      </span>
      <strong aria-live="polite">{41 + (liked ? 1 : 0)}</strong>
    </button>
  );
}
