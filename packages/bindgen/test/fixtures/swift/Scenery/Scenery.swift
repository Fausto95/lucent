import CoreGraphics

/// A Swift module shaped like SwiftUI, in miniature: views made by their
/// initializers, modifiers in a protocol extension, values as statics, a
/// result builder, a property wrapper and a global function.
public protocol View {}

public protocol ShapeStyle {}

public protocol Shape: View {
  /// A requirement: a shape's types implement it.
  func path(in size: Double) -> Double
}

@resultBuilder
public struct ViewBuilder {
  public static func buildBlock<C: View>(_ content: C) -> C { content }
  public static func buildBlock<C0: View, C1: View>(_ c0: C0, _ c1: C1) -> Pair<C0, C1> {
    Pair(first: c0, second: c1)
  }
}

/// Another name for the builder, as SwiftUI's ContentBuilder is.
public typealias ContentBuilder = ViewBuilder

public struct Pair<First: View, Second: View>: View {
  let first: First
  let second: Second
}

/// A type a string literal makes, as SwiftUI's LocalizedStringKey.
public struct Key: ExpressibleByStringLiteral {
  public init(stringLiteral value: String) {}
}

@propertyWrapper
public struct Binding<Value> {
  public var wrappedValue: Value
  public init(wrappedValue: Value) { self.wrappedValue = wrappedValue }
  public static func constant(_ value: Value) -> Binding<Value> { Binding(wrappedValue: value) }
}

public struct HorizontalAlignment {
  public static let center = HorizontalAlignment()
  public static let leading = HorizontalAlignment()
}

public struct Alignment {
  public static let center = Alignment()
}

public enum Edge {
  case top, bottom

  public struct Set: OptionSet {
    public let rawValue: Int8
    public init(rawValue: Int8) { self.rawValue = rawValue }
    public static let horizontal = Set(rawValue: 1)
  }
}

public struct Animation {
  public static let `default` = Animation()
  public static func spring(response: Double = 0.5, dampingFraction: Double = 0.825) -> Animation {
    Animation()
  }
  public static func easeInOut(duration: Double) -> Animation { Animation() }
  /// Named like the method: the call is what takes arguments.
  public static var easeInOut: Animation { Animation() }
}

public struct Color: View, ShapeStyle {
  public static let green = Color(red: 0, green: 1, blue: 0)
  public init(red: Double, green: Double, blue: Double, opacity: Double = 1) {}
  public func opacity(_ opacity: Double) -> Color { self }
}

public struct Text: View {
  public init(_ key: Key, comment: StaticString? = nil) {}
  public init<S: StringProtocol>(_ content: S) {}
  public func bold() -> Text { self }
}

public struct VStack<Content: View>: View {
  public init(
    alignment: HorizontalAlignment = .center, spacing: Double? = nil,
    @ContentBuilder content: () -> Content
  ) {}
}

public struct Button<Label: View>: View {
  public init(action: @escaping @MainActor () -> Void, @ViewBuilder label: () -> Label) {}
}

extension Button where Label == Text {
  public init(_ title: Key, action: @escaping @MainActor () -> Void) {}
}

public struct Toggle<Label: View>: View {
  public init(isOn: Binding<Bool>, @ViewBuilder label: () -> Label) {}
}

public struct ForEach<Content: View>: View {
  public init(_ count: Int, @ViewBuilder content: @escaping (Int) -> Content) {}
}

public struct Labeled<Title: View, Icon: View>: View {
  public init(@ViewBuilder title: () -> Title, @ViewBuilder icon: () -> Icon) {}
}

/// A slider: a Binding and a range of any floating-point type, and its step.
public struct Slider<Label: View>: View {}

extension Slider where Label == Text {
  public init<V>(
    value: Binding<V>, in bounds: ClosedRange<V> = 0...1,
    onEditingChanged: @escaping (Bool) -> Void = { _ in }
  ) where V: BinaryFloatingPoint, V.Stride: BinaryFloatingPoint {}
}

extension Slider {
  public init<V>(
    value: Binding<V>, in bounds: ClosedRange<V>, step: V.Stride = 1,
    @ViewBuilder label: () -> Label, onEditingChanged: @escaping (Bool) -> Void = { _ in }
  ) where V: BinaryFloatingPoint, V.Stride: BinaryFloatingPoint {}
}

/// A picker: a Binding of any hashable value, which its content's tags are.
public struct Choice<SelectionValue: Hashable, Content: View>: View {
  public init(selection: Binding<SelectionValue>, @ViewBuilder content: () -> Content) {}
}

/// A swatch: a Binding of a value of the module's own, which no signal holds.
public struct Swatch: View {
  public init(selection: Binding<Color>) {}
}

/// A stepper: a Binding of anything that strides.
public struct Stepper<Label: View>: View {
  public init<V: Strideable>(
    value: Binding<V>, in bounds: ClosedRange<V>, step: V.Stride = 1,
    @ViewBuilder label: () -> Label
  ) {}
}

/// A progress bar: a value of any floating-point type, out of a total.
public struct Meter: View {
  public init<V>(value: V?, total: V = 1.0) where V: BinaryFloatingPoint {}
}

public struct Circle: Shape {
  public init() {}
  public func path(in size: Double) -> Double { size }
}

/// A class: an object, not a value a body writes.
public final class Host {
  public init() {}
  public func show() {}
}

extension View {
  public func padding(_ length: Double) -> some View { self }
  public func padding(_ edges: Edge.Set = .horizontal, _ length: Double? = nil) -> some View { self }
  public func frame(width: Double? = nil, height: Double? = nil, alignment: Alignment = .center)
    -> some View
  { self }
  public func onTapGesture(count: Int = 1, perform action: @escaping () -> Void) -> some View {
    self
  }
  public func onLongPress(perform action: @escaping (Double) -> Void) -> some View { self }
  public func animation<V>(_ animation: Animation?, value: V) -> some View where V: Equatable {
    self
  }
  @available(iOS 17.0, *)
  public func onChange<V: Equatable>(
    of value: V, initial: Bool = false, _ action: @escaping (V, V) -> Void
  ) -> some View { self }
  @available(iOS, introduced: 14.0, deprecated: 17.0)
  public func onChange<V: Equatable>(of value: V, perform action: @escaping (V) -> Void)
    -> some View
  { self }
  public func tag<V: Hashable>(_ tag: V) -> some View { self }
  /// Closures that return a value to SwiftUI, which a callback calling the setup does not.
  public func onDropped(perform action: @escaping (Double) -> Bool) -> some View { self }
  public func marked(_ radius: Double, mark: @escaping (Double) -> Double = { $0 }) -> some View {
    self
  }
  public func foregroundStyle<S: ShapeStyle>(_ style: S) -> some View { self }
  public func overlay<V>(alignment: Alignment = .center, @ViewBuilder content: () -> V)
    -> some View where V: View
  { self }
  public func tinted<S: ShapeStyle & View>(_ style: S) -> some View { self }
  public func sized(_ size: CGSize) -> some View { self }
  @available(iOS 17.0, *)
  public func glow(_ radius: Double) -> some View { self }
}

extension Shape {
  public func fill<S: ShapeStyle>(_ content: S) -> some View { self }
}

public func withAnimation<Result>(_ animation: Animation? = .default, _ body: () throws -> Result)
  rethrows -> Result
{
  try body()
}
