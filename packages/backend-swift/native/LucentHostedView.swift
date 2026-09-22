import UIKit
import SwiftUI
@MainActor
final class LucentHostedView: UIView {
  private let controller = UIHostingController(rootView: AnyView(EmptyView()))
  override init(frame: CGRect) {
    super.init(frame: frame)
    controller.view.backgroundColor = .clear
    addSubview(controller.view)
  }
  required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
  func render(_ content: AnyView) { controller.rootView = content }
  override func layoutSubviews() {
    super.layoutSubviews()
    controller.view.frame = bounds
  }
  override func didMoveToWindow() {
    super.didMoveToWindow()
    if window == nil {
      controller.willMove(toParent: nil)
      controller.removeFromParent()
      return
    }
    var responder: UIResponder? = self
    while let current = responder {
      if let parent = current as? UIViewController {
        if controller.parent !== parent {
          controller.willMove(toParent: nil)
          controller.removeFromParent()
          parent.addChild(controller)
          controller.didMove(toParent: parent)
        }
        break
      }
      responder = current.next
    }
  }
}
