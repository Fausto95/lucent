# 0056. Android's oldest API is the app's minSdk

- **Date:** 2026-10-08
- **Status:** accepted

The `lucentClasspath` Gradle task writes the app's `minSdk` and `compileSdk` beside its classpath; `LUCENT3007` checks Android APIs against that `minSdk` (24 until Gradle has run), and the bound platform is the `compileSdk`'s when installed, else the newest. _Why:_ a fixed 24 made apps at a higher `minSdk` write checks their devices never fail, and the newest platform could bind APIs the app's `compileSdk` does not have.
