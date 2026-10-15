---
"@lucent-lang/lucent": minor
---

A SwiftUI or Compose body takes instance props. The instance stays in C++: the body shows what the setup computes from it (`props.player.title`, what a method returns), read on the main thread when the prop changes, and its callbacks call setup functions, which call the instance's methods. The members its values use are checked as setup code's are (LUCENT3022). The body calling an instance's method itself, or showing a list of instances, is LUCENT3024, whose message shows the setup function to write.
