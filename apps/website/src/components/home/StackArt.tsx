/**
 * Lucent's stack as floating isometric blocks: the source language on top,
 * compiled C++ under it, iOS and Android at the base.
 */
export function StackArt() {
  return (
    <svg
      className="stack-art"
      viewBox="40 -32 640 535"
      role="img"
      aria-labelledby="voltage-stack-title voltage-stack-desc"
    >
      <title id="voltage-stack-title">Lucent, compiled for iOS and Android</title>
      <desc id="voltage-stack-desc">
        Gently floating blocks labeled lucent, C++20, iOS, and Android. Lucent compiles native logic
        and generates platform UI. Animation is disabled when reduced motion is preferred.
      </desc>

      <g className="float-ios">
        <g className="edge">
          <path className="baseside" d="M100 360 L262 450 L262 490 L100 400 Z" />
          <path className="baseside" d="M262 450 L432 352 L432 392 L262 490 Z" />
          <path className="baseface" d="M100 360 L270 262 L432 352 L262 450 Z" />
        </g>
        <text
          className="base-label"
          textAnchor="middle"
          dominantBaseline="middle"
          transform="translate(347 421) rotate(-30)"
        >
          iOS
        </text>
      </g>

      <g className="float-android">
        <g className="edge">
          <path className="baseside" d="M306 241 L468 331 L468 371 L306 281 Z" />
          <path className="baseside" d="M468 331 L638 233 L638 273 L468 371 Z" />
          <path className="baseface" d="M306 241 L476 143 L638 233 L468 331 Z" />
        </g>
        <text
          className="base-label"
          textAnchor="middle"
          dominantBaseline="middle"
          transform="translate(553 302) rotate(-30)"
        >
          Android
        </text>
      </g>

      <g className="float-logic">
        <g className="edge">
          <path fill="#b0d95e" d="M100 290 L262 380 L262 420 L100 330 Z" />
          <path fill="#c4f85a" d="M262 380 L638 163 L638 203 L262 420 Z" />
          <path fill="#e0ff9f" d="M100 290 L476 73 L638 163 L262 380 Z" />
        </g>
        <text
          className="logictext"
          textAnchor="middle"
          dominantBaseline="middle"
          transform="translate(450 291.5) rotate(-30)"
        >
          C++20
        </text>
      </g>

      <g className="float-source">
        <g className="edge">
          <path className="sideface" d="M100 210 L262 300 L262 340 L100 250 Z" />
          <path className="sideface" d="M262 300 L638 83 L638 123 L262 340 Z" />
          <path className="topface" d="M100 210 L476 -7 L638 83 L262 300 Z" />
        </g>
        <text
          className="slabtext"
          textAnchor="middle"
          dominantBaseline="middle"
          transform="translate(369 146.5) rotate(-30)"
        >
          lucent
        </text>
      </g>
    </svg>
  );
}
