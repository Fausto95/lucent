---
"@lucent-lang/lucent": minor
---

Let a component take an instance of an exported class as a prop, alone, `T | null` or in an array (`<VideoView player={player} />`): the view holds the instance while it shows it, and the component's React types name its class. Another value throws a `TypeError` where React renders. A member the view uses that code off the main thread uses too, either of them writing it, fails with LUCENT3022, naming both uses. A non-exported class's instance as a prop now fails with a message saying to export the class.
