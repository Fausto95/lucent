---
"@lucent-lang/lucent": minor
---

Lucent classes can extend Objective-C classes on iOS, as they extend SDK classes on Android: `class Greeting extends UIViewController` is made with the base initializer `super(…)` names, its methods override the base's (UIKit calling `viewDidLoad` runs the Lucent one), `super.viewDidLoad()` calls UIKit's, and inherited members such as `this.view` work on the instance, which passes wherever the base type is taken. A generated Objective-C subclass stands for each instance; it and the Lucent object keep each other alive while either side uses them, without a cycle. Subclasses of main-thread classes are used on the main thread.
