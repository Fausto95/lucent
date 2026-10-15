# 0122. A SwiftUI or Compose body's list may show instances

- **Date:** 2026-10-16
- **Status:** accepted

Amends [0121](0121-an-instance-prop-stays-in-cpp-in-a-toolkit-body.md),
whose lists showed plain data alone ([T123](../tasks.md#t123)).

A body's list may show an array of instances (`props.players`, what a
setup function returns). It is a list slot like any other: the setup
keeps the items, keyed by what the key computes from each (`(p) =>
p.title`), in `lucent::ui::Items<Key, Ref<T>>`. Its records hold what the
setup computes for each item (`p.label()`), and an action given an item
(`() => pick(p)`) finds it again by its key, as for plain items. An
instance never crosses into Swift or Kotlin. What an item's values call
is setup code to the analyses: a list's item counts as the setup's name,
and the members it uses are checked as 0098 says.

_Why:_ a list's items already crossed as their keys and the values the
setup computed for them, so nothing of an item had to be plain but what
crossed. Mapping instances to plain rows in a setup function, 0121's
answer, lost what an action could do with the item.
_Changed:_ [views.md](../design/views.md#instances),
[limitations.md](../limitations.md) and T123's first item.
