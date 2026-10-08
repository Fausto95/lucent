# 0031. Native views are laid out by a `Flex` tag

- **Date:** 2026-10-05
- **Status:** accepted

A subtree
Lucent lays out with Yoga is written as `<Flex style={…}>` from
`lucent:ui`, backed by runtime classes (a UIView subclass, a ViewGroup);
each child's Yoga style is its `layout={{…}}` attribute, refused outside
a Flex. A plain UIView stays unmanaged, and a native container keeps
laying out its own children. _Why:_ the design asks for an explicitly
created layout container, and a tag makes ownership a matter of the
element, never of a prop (a width must not switch who writes a frame);
one `layout` object never clashes with a native prop of the same name
(Android's `setPadding`). Not a cross-platform view vocabulary (T51):
the children stay each platform's views. _Changed:_ T50's scope (a
`Flex` tag and `layout`, no automatic layout of plain parents).
