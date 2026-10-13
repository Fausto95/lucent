# 0097. An exported class extending an Android class is one the OS can make

- **Date:** 2026-10-13
- **Status:** accepted

The decision [T131](../tasks.md#t131) starts with. A Lucent class that a
module exports and that extends an Android SDK class gets a Java class the
OS can instantiate by name: a `Worker`, a `Service`, a `BroadcastReceiver`,
a `Fragment`. Exporting it is the mark, with no list of bases.

- **Name.** `dev.lucent.app.<module>.<Class>`, where the module's name
  (`<package>/<path>`) becomes Java package segments: `/` separates them,
  and every other character but letters and digits becomes `_`. So
  `lucent-sync/workers`'s `SyncWorker` is
  `dev.lucent.app.lucent_sync.workers.SyncWorker`. A segment that is a
  Java keyword or starts with a digit gets a `_` in front. The name lasts
  while the module's path and the class's name do. Two classes whose names
  come out the same get none, with a warning, as entry points do
  ([0094](0094-exports-that-would-share-an-entry-point-get-none.md)).
- **Constructor.** The Java class declares one public constructor, with
  the Lucent constructor's parameters, or none without one. It passes them
  to the base's constructor in order, so the Lucent constructor's `super`
  call must pass its parameters unchanged, and the base must declare that
  constructor. A `Worker`'s is `(Context, WorkerParameters)`.
- **Instance.** The constructor then makes the Lucent instance through the
  native root ([0090](0090-module-state-resets-only-when-nothing-native-holds-it.md)).
  Module state starts if none lasts, and the instance holds it while it
  lives. The Lucent constructor runs on the calling thread, holding its
  module's actor, as a main-thread entry when that thread is the main one.
  The instance goes when Java collects the object.
- **Lucent code** makes such a class with `new` only when its base has a
  constructor without arguments, as today. Only the OS makes a `Worker`.
- **Manifest.** `lucent.json`'s `android.components[].class` names the
  Lucent class, as `<module path>#<Class>` within the package, and the
  manifest's `android:name` is then its Java class.
- **Declaration.** A module's Android file exports such a class without
  its shared file declaring it, since JavaScript never sees it.

_Why:_ an export is how a module names something for code outside it, and
WorkManager, `FragmentManager` and the manifest name classes. Recognizing
`Worker` or `Service` as bases would be a catalog entry. The metadata says
which constructors a base declares, not which one the OS calls, but the
Lucent constructor says which it means. WorkManager stores a worker's class
name in its database, so the name comes from what the code names and stays
across builds, unlike today's names from the C++ class
(`javaSubclassName`). _Changed:_
[native-platform.md](../design/native-platform.md#android-classes-the-os-instantiates)'s
open questions.
