// A miniature of UIKit for the host's SwiftUI checks (mini-swiftui.ts): what
// the Swift a SwiftUI body generates uses of it, so that the Swift
// type-checks where Xcode is missing.
@_exported import Foundation
// CGSize's members are CoreGraphics' on Apple's platforms; Linux's Foundation has them.
#if canImport(CoreGraphics)
@_exported import CoreGraphics
#endif

open class UIColor {
  public static let clear = UIColor()
  public init() {}
}

open class UIView {
  open var backgroundColor: UIColor?
  public init() {}
}

@MainActor
open class UIViewController {
  open var view: UIView! = UIView()
  open var preferredContentSize: CGSize = .zero
  public init() {}
}
