---
"@lucent-lang/lucent": minor
---

Say exactly what the app needs after a build. `lucent build` lists `actions` (also in `--json` and the build record): recompile native code, reload JavaScript, repackage resources, relink native dependencies or reinstall the app, each with its platforms and the files behind it. They come from what the build changed: a body edit recompiles, new exports also reload JavaScript, a package's resources are repackaged. `lucent dev` now watches Lucent packages outside the app (workspace or linked) whole, including their `lucent.json` and native files, never rebuilds for what builds write, and stops a build a newer change made stale before it writes anything. Generated files are replaced whole, so Metro never reads half a proxy. Package files are hashed once while their size and times hold, and lucent build no longer starts a second Gradle run while another one resolves the classpath.
