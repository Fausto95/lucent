// For swiftui_run_test.mm: calls a SwiftUI component's action as its
// body's callback does (the model's actions: their C context and invoke
// function), found in its hosting controller with Swift's reflection.
import UIKit

/// The first value labeled one of `labels` under `value`, depth first.
private func find(_ labels: Set<String>, in value: Any, depth: Int = 0) -> Any? {
  guard depth < 8 else { return nil }

  var mirror: Mirror? = Mirror(reflecting: value)

  while let m = mirror {
    for child in m.children {
      if let label = child.label, labels.contains(label) { return child.value }
      if let found = find(labels, in: child.value, depth: depth + 1) { return found }
    }

    mirror = m.superclassMirror
  }

  return nil
}

@_cdecl("lucent_test_act")
@MainActor
public func lucentTestAct(_ controller: UnsafeMutableRawPointer, _ index: Int32) {
  let hosting = Unmanaged<UIViewController>.fromOpaque(controller).takeUnretainedValue()

  // The view's model is an observed object: its property wrapper's storage is `_model`.
  guard let model = find(["model", "_model"], in: hosting), let actions = find(["actions"], in: model) else {
    fatalError("no model with actions in \(hosting)")
  }

  let parts = Mirror(reflecting: actions)
  let context = parts.descendant("context") as! UnsafeMutableRawPointer
  let invoke =
    parts.descendant("invoke") as! @convention(c) (UnsafeMutableRawPointer, Int32, UnsafeMutableRawPointer) -> Void

  // No arguments: an empty array, which the call takes.
  invoke(context, index, Unmanaged.passRetained([] as NSArray).toOpaque())
}
