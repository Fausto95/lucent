# @lucent-lang/lucent

## 0.0.5

### Patch Changes

- [`be7d600`](https://github.com/Fausto95/lucent/commit/be7d6006c5eca7730fbf69e2d0d9eea912f7a604) Thanks [@Fausto95](https://github.com/Fausto95)! - Add a README to the npm package: what Lucent does, how to install it, what the package contains and where the docs are.

## 0.0.4

### Patch Changes

- [#8](https://github.com/Fausto95/lucent/pull/8) [`80aceab`](https://github.com/Fausto95/lucent/commit/80aceab2a13470731b61fa5e8b04aa5eb7ed69b0) Thanks [@Fausto95](https://github.com/Fausto95)! - Keep `instanceof` working for Lucent classes after an app reinstalls Lucent without a new JavaScript runtime: new instances now share their class's prototype.

- [#7](https://github.com/Fausto95/lucent/pull/7) [`edaff0e`](https://github.com/Fausto95/lucent/commit/edaff0e9c7ef5e3989e2798a1ab35cc323f00b73) Thanks [@Fausto95](https://github.com/Fausto95)! - Build the CLI and compiler with Vite+ (tsdown on Rolldown) instead of esbuild: the published package keeps the same files, and its JavaScript is about 5% smaller.
