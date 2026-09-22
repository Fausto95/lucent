# @lucent-lang/cli

`lucent` is the command line for [Lucent](https://github.com/Fausto95/lucent):
write native React Native modules in TypeScript, compiled ahead of time to
Swift and Kotlin. No JavaScript runs on the native side.

```sh
npx @lucent-lang/cli init      # wire an Expo or bare React Native app
npx @lucent-lang/cli doctor    # check the toolchain and the project wiring
npx @lucent-lang/cli build     # compile *.lucent.ts into the native package
```

Inside a project that lists `@lucent-lang/cli` as a dev dependency,
`npx lucent <command>` runs the local copy.

| Command   | What it does                                                                    |
| --------- | ------------------------------------------------------------------------------- |
| `build`   | Compile every `*.lucent.ts` into the Expo or Nitro package; `--watch`, `--json` |
| `check`   | Type-check without generating; `--watch`, `--json`                              |
| `init`    | Add dependencies, `lucent.config.ts`, Metro wiring, the host plugin, a starter  |
| `doctor`  | Verify Node, Swift, Kotlin and the project's Lucent wiring, with fixes          |
| `explain` | Describe a diagnostic code such as `LUCENT1004`, or list them all               |
| `ir`      | Print a module's typed intermediate representation                              |
| `clean`   | Remove the cache, IR dumps and the generated package                            |
| `sdk`     | Extract bindings from a `.swiftinterface` file or a `javap` listing             |

Every command accepts `--help`. Global flags: `--json`, `--quiet`,
`--no-color` (also `NO_COLOR` / `FORCE_COLOR`), `--no-emoji` (also `NO_EMOJI`).
The host is detected from `package.json`; pass `--host expo|nitro` to override.

Docs: [getting started](https://github.com/Fausto95/lucent/blob/main/docs/getting-started.md)
· [the language](https://github.com/Fausto95/lucent/blob/main/docs/language.md)

MIT © Lucent
