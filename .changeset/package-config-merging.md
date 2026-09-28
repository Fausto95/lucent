---
"@lucent-lang/lucent": minor
---

Check and merge Lucent packages' `lucent.json` with clear rules. An unknown field or a value of the wrong type fails the build, naming the package and the field. Every package's requirement on a pod goes to CocoaPods, and every version of a Gradle artifact goes to Gradle, instead of failing when two packages write different versions; requirements no version can meet, and a strict Gradle version another package's excludes, still fail naming both packages. `ios.frameworks` lists Apple frameworks to link. `Info.plist` values can be booleans and arrays of strings; arrays from several packages join, and the Expo config plugin adds the values an app's array lacks. The merged result, with the package each need came from, is written to `.lucent/native/resolved.json`.
