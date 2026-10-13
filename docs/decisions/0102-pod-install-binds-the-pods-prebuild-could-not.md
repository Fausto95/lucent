# 0102. pod install binds the pods prebuild could not

- **Date:** 2026-10-14
- **Status:** accepted

The iOS build step that binds a Lucent package's pods once installed
(decision 0034) is a CocoaPods hook, `lucent_post_install` in the
package's `cocoapods/lucent.rb`, which the Expo config plugin calls first
in the Podfile's `post_install`. `expo prebuild`'s build skips iOS while
such a pod is missing from `Podfile.lock`, and warns. Prebuild's
`pod install` installs the pod, and the hook runs `lucent build` then. It
adds the sources that build wrote to the `LucentNative` target, and the
frameworks it added to the app's Pods xcconfigs, as the next `pod install`
would. The pod's build phase runs `lucent build` in every Xcode build, and
fails, asking for `pod install`, when a build changed the pod's files.

_Why:_ CocoaPods lists a pod's files at `pod install`, so the files a
build writes after it are not compiled until the next one. Only
`post_install` runs between the pods' install and the app's build, in
every flow: prebuild, EAS, CI. There the Pods project is not saved yet,
so the hook can add what the build wrote. A build phase alone would need
a second `pod install` by hand. _Changed:_ [T141](../tasks.md#t141), and
how decision 0034's step is made.
