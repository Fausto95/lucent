import type { IRExpr } from "@lucent-lang/compiler";
type ViewExpr = Extract<IRExpr, { op: "view" }>;
function handler(e: ViewExpr, name: string, fallback: string, argument: string): string {
  const found = e.props.find((prop) => prop.name === name);
  if (!found) return fallback;
  if (found.value.op !== "closure") return exprHolder(found.value);
  return `{ ${argument} in _ = try? ${exprHolder(found.value)}(${argument === "_" ? "" : argument}) }`;
}
let exprHolder: (e: IRExpr) => string = (e) => {
  throw new Error(`swift view expression before emitter: ${e.op}`);
};
export function swiftView(e: ViewExpr, expr: (e: IRExpr) => string): string {
  exprHolder = expr;
  const prop = (name: string, fallback: string) => {
    const found = e.props.find((p) => p.name === name);
    return found ? expr(found.value) : fallback;
  };
  const children = e.children.map(expr).join("; ");
  if (e.native) {
    const descriptor = e.native.swift;
    const rendered = descriptor.template.replace(/{{([^}]+)}}/g, (_, token: string) =>
      token === "children" ? children : prop(token.slice(5), descriptor.defaults?.[token.slice(5)] ?? ""),
    );
    return `AnyView(${rendered})`;
  }
  const render: Record<string, () => string> = {
    TextField: () =>
      `TextField(${prop("placeholder", '""')}, text: Binding(get: { ${prop("value", '""')} }, set: ${handler(e, "onChange", "{ _ in }", "lucentNew")}))`,
    Toggle: () =>
      `Toggle(${prop("title", '""')}, isOn: Binding(get: { ${prop("value", "false")} }, set: ${handler(e, "onChange", "{ _ in }", "lucentNew")}))`,
    Slider: () =>
      `Slider(value: Binding(get: { ${prop("value", "0")} }, set: ${handler(e, "onChange", "{ _ in }", "lucentNew")}), in: ${prop("min", "0")}...max(${prop("min", "0")},${prop("max", "1")}))`,
    ScrollView: () => `ScrollView { VStack(alignment: .leading, spacing: 0) { ${children} } }`,
    ZStack: () => `ZStack { ${children} }`,
    Padding: () => `VStack(alignment: .leading, spacing: 0) { ${children} }.padding(CGFloat(${prop("value", "0")}))`,
    Background: () =>
      `VStack(alignment: .leading, spacing: 0) { ${children} }.background(lucentViewColor(${prop("color", '"#000000"')}))`,
    CornerRadius: () =>
      `VStack(alignment: .leading, spacing: 0) { ${children} }.clipShape(RoundedRectangle(cornerRadius: CGFloat(${prop("value", "0")})))`,
    Accessibility: () =>
      `VStack(alignment: .leading, spacing: 0) { ${children} }.accessibilityLabel(${prop("label", '""')})`,
    VStack: () =>
      `VStack(alignment: .leading, spacing: CGFloat(${prop("spacing", "0")})) { ${children} }.padding(CGFloat(${prop("padding", "0")}))`,
    HStack: () =>
      `HStack(spacing: CGFloat(${prop("spacing", "0")})) { ${children} }.padding(CGFloat(${prop("padding", "0")}))`,
    Text: () =>
      `Text(${e.children.length ? e.children.map(expr).join(" + ") : '""'}).font(.system(size: CGFloat(${prop("size", "17")})))${e.props.some((p) => p.name === "color") ? `.foregroundColor(lucentViewColor(${prop("color", '"#000000"')}))` : ""}`,
    Spacer: () => `Color.clear.frame(width: CGFloat(${prop("size", "8")}), height: CGFloat(${prop("size", "8")}))`,
    Button: () => {
      const found = e.props.find((p) => p.name === "onPress");
      const action = !found
        ? ""
        : found.value.op === "closure"
          ? `_ = try? ${expr(found.value)}()`
          : `${expr(found.value)}()`;
      return `Button(${prop("title", '""')}) { ${action} }`;
    },
    Divider: () => `Divider()`,
  };
  return `AnyView(${render[e.name]!()})`;
}
export const swiftViewRuntime = `import SwiftUI
func lucentViewColor(_ value: String) -> Color {
  let hex = value.hasPrefix("#") ? String(value.dropFirst()) : value
  guard hex.count == 6, let rgb = UInt32(hex, radix: 16) else { return .primary }
  return Color(red: Double((rgb >> 16) & 255) / 255, green: Double((rgb >> 8) & 255) / 255, blue: Double(rgb & 255) / 255)
}
`;

/** SwiftUI controller containment, layout, and teardown shared by both hosts. */
export const swiftHostedViewRuntime = `import UIKit
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
`;
