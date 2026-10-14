---
"@lucent-lang/lucent": minor
---

A component's Android code can return an androidx `Fragment`, as it returns a view: the host adds it to the Activity's `FragmentManager` over a container in the component, once the component is in a window, and removes it when React unmounts the component. When Android recreates the Activity, the host drops the component fragments it restored, and their components make new ones.
