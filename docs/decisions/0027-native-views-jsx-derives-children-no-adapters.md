# 0027. Native views' JSX derives children; no adapters

- **Date:** 2026-10-04
- **Status:** accepted

A view
class takes JSX children through the insert-at-index method its
declarations give (`insertArrangedSubview:atIndex:`,
`insertSubview:atIndex:`, `addView(View, int)`); the design's
package-authored `defineChildAdapter` was dropped. A JSX element is the
toolkit's view and the platform's root view at once (`View & UIView`), so
native JSX is returned from a component declared as returning the root
view. _Why:_ an adapter was machinery each component repeated for what the
declarations already say, and children are as derivable as props and
events; the intersection keeps one JSX namespace per platform file.
_Changed:_ T48's scope (children by rule, no adapter API), C-VIEW v2.3,
and design 16.5's note.
