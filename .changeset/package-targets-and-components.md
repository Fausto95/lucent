---
"@lucent-lang/lucent": minor
---

Let Lucent packages declare entitlements, Swift packages, Android manifest components and minimum platform versions in `lucent.json`: `ios.entitlements` (merged like `Info.plist` entries and added by the Expo config plugin; bare apps are told what their `.entitlements` file lacks), `ios.swiftPackages` (one requirement per package URL, products joined, added with React Native's `spm_dependency`), `ios.deploymentTarget` and `android.minSdk` (the highest any package needs), and `android.components` (services, receivers, activities and providers, declared once in the native package's manifest; packages that declare one differently fail the build, naming both).
