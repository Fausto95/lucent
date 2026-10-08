# lucent-orbit

Kotlin libraries called from Lucent, through the Kotlin shims Lucent
generates: a fixture library of its own (`kotlin/`, shipped as
`android/orbit.jar`) and two Jetpack libraries from Gradle, DataStore
Preferences and Credential Manager. Android only: on iOS each export says
there's no Kotlin.

## Files

| File                                                   | What it is                                                                                                              |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| `kotlin/`                                              | The fixture library's Kotlin: suspend functions, defaults, value and sealed classes, `Long` ids, collections and flows. |
| `build-jar.ts`                                         | Compiles `kotlin/` into `android/orbit.jar` (needs `kotlinc` on the `PATH`).                                            |
| `android/orbit.jar`                                    | The library the package ships, committed.                                                                               |
| `lucent.json`                                          | Ships the JAR (`android.libraries`) and adds DataStore and Credential Manager (`android.dependencies`).                 |
| `src/orbit.lucent.ts`                                  | Suspend functions, cancellation, defaults, sealed classes with `instanceof`, value classes.                             |
| `src/collections.lucent.ts`, `src/flows.lucent.ts`     | Kotlin collections, and `Flow`s collected with `subscribe`.                                                             |
| `src/datastore.lucent.ts`, `src/credentials.lucent.ts` | The Jetpack ports.                                                                                                      |

The package's page on the website:
[Orbit](https://lucent-lang.dev/docs/packages/examples/orbit/).

## Build and check it

Both example apps depend on it, and their Lab's Kotlin screen runs every
export. On its own:

```sh
cd examples/lucent-orbit
node ../../packages/lucent/bin/lucent.cjs build --platforms host
node build-jar.ts            # after changing kotlin/
```

`--platforms host` compiles it without the Android SDK; the Kotlin
library binds once an app with an `android/` project resolves its Gradle
dependencies.
