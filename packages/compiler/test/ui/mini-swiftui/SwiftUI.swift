// A miniature of SwiftUI for the host (mini-swiftui.ts): the shapes the
// SwiftUI writer reads in the real one (views made by their initializers,
// labeled arguments, result-builder content, modifiers in View's
// extension, values as statics, Binding, the environment) and the Swift a
// body generates uses (ObservableObject, @Published, @ObservedObject,
// UIHostingController). Its schema stands for SwiftUI's in a schema set,
// and the generated Swift type-checks against it, where Xcode is missing.
// It declares what tests use, not SwiftUI.
import Foundation
@_exported import UIKit

// --- views and their content ----------------------------------------------------------

public protocol View {}

public struct EmptyView: View {
  public init() {}
}

public struct TupleView<T>: View {
  public init(_ value: T) {}
}

public struct ConditionalContent<A: View, B: View>: View {}

@resultBuilder
public struct ViewBuilder {
  public static func buildBlock() -> EmptyView { EmptyView() }
  public static func buildBlock<C: View>(_ c: C) -> C { c }
  public static func buildBlock<C0: View, C1: View>(_ c0: C0, _ c1: C1) -> TupleView<(C0, C1)> {
    TupleView((c0, c1))
  }
  public static func buildBlock<C0: View, C1: View, C2: View>(_ c0: C0, _ c1: C1, _ c2: C2)
    -> TupleView<(C0, C1, C2)>
  { TupleView((c0, c1, c2)) }
  public static func buildBlock<C0: View, C1: View, C2: View, C3: View>(
    _ c0: C0, _ c1: C1, _ c2: C2, _ c3: C3
  ) -> TupleView<(C0, C1, C2, C3)> { TupleView((c0, c1, c2, c3)) }
  public static func buildBlock<C0: View, C1: View, C2: View, C3: View, C4: View>(
    _ c0: C0, _ c1: C1, _ c2: C2, _ c3: C3, _ c4: C4
  ) -> TupleView<(C0, C1, C2, C3, C4)> { TupleView((c0, c1, c2, c3, c4)) }
  public static func buildIf<C: View>(_ c: C?) -> C? { c }
  public static func buildOptional<C: View>(_ c: C?) -> C? { c }
  public static func buildEither<A: View, B: View>(first: A) -> ConditionalContent<A, B> {
    ConditionalContent()
  }
  public static func buildEither<A: View, B: View>(second: B) -> ConditionalContent<A, B> {
    ConditionalContent()
  }
}

extension Optional: View where Wrapped: View {}

/// A type a string literal makes, as SwiftUI's LocalizedStringKey.
public struct LocalizedStringKey: ExpressibleByStringLiteral, ExpressibleByStringInterpolation {
  public init(stringLiteral value: String) {}
}

public struct Text: View {
  public init(_ key: LocalizedStringKey) {}
  @_disfavoredOverload
  public init<S: StringProtocol>(_ content: S) {}
  /// A date, as `style` shows it (a widget's body shows its entry's).
  public init(_ date: Date, style: Text.DateStyle) {}
  public func bold() -> Text { self }
}

extension Text {
  public struct DateStyle {
    public static let date = DateStyle()
    public static let time = DateStyle()
    public static let relative = DateStyle()
    public static let timer = DateStyle()
  }
}

public struct Image: View {
  public init(systemName: String) {}
}

public struct Spacer: View {
  public init(minLength: Double? = nil) {}
}

public struct HorizontalAlignment {
  public static let center = HorizontalAlignment()
  public static let leading = HorizontalAlignment()
  public static let trailing = HorizontalAlignment()
}

public struct VerticalAlignment {
  public static let center = VerticalAlignment()
  public static let top = VerticalAlignment()
  public static let bottom = VerticalAlignment()
}

public struct Alignment {
  public static let center = Alignment()
  public static let leading = Alignment()
  public static let trailing = Alignment()
}

public struct VStack<Content: View>: View {
  public init(
    alignment: HorizontalAlignment = .center, spacing: Double? = nil,
    @ViewBuilder content: () -> Content
  ) {}
}

public struct HStack<Content: View>: View {
  public init(
    alignment: VerticalAlignment = .center, spacing: Double? = nil,
    @ViewBuilder content: () -> Content
  ) {}
}

public struct ZStack<Content: View>: View {
  public init(alignment: Alignment = .center, @ViewBuilder content: () -> Content) {}
}

public struct Button<Label: View>: View {
  public init(action: @escaping @MainActor () -> Void, @ViewBuilder label: () -> Label) {}
}

extension Toggle where Label == Text {
  public init(_ titleKey: LocalizedStringKey, isOn: Binding<Bool>) {}
  @_disfavoredOverload
  public init<S: StringProtocol>(_ title: S, isOn: Binding<Bool>) {}
}

extension Button where Label == Text {
  public init(_ titleKey: LocalizedStringKey, action: @escaping @MainActor () -> Void) {}
}

public struct Toggle<Label: View>: View {
  public init(isOn: Binding<Bool>, @ViewBuilder label: () -> Label) {}
}

/// Its parameters unconstrained, its initializers constrained: the schema's
/// call form leaves out what the constraints of the type itself bind.
public struct ForEach<Data, ID, Content>: View {}

extension ForEach where Data: RandomAccessCollection, ID: Hashable, Content: View {
  public init(
    _ data: Data, id: KeyPath<Data.Element, ID>,
    @ViewBuilder content: @escaping (Data.Element) -> Content
  ) {}
}

extension ForEach
where Data: RandomAccessCollection, Data.Element: Identifiable, ID == Data.Element.ID, Content: View {
  public init(_ data: Data, @ViewBuilder content: @escaping (Data.Element) -> Content) {}
}

extension ForEach {
  /// A static the call form writes, so that lucent:swiftui declares ForEach's
  /// value, which Lucent's list form merges into (toolkit-forms.ts): the SDK's
  /// ForEach has members it writes.
  public static var none: EmptyView { EmptyView() }
}

// --- values --------------------------------------------------------------------------

public protocol ShapeStyle {}

public struct Color: View, ShapeStyle, Equatable {
  public static let red = Color(red: 1, green: 0, blue: 0)
  public static let green = Color(red: 0, green: 1, blue: 0)
  public static let blue = Color(red: 0, green: 0, blue: 1)
  public static let gray = Color(red: 0.5, green: 0.5, blue: 0.5)
  public static let white = Color(red: 1, green: 1, blue: 1)
  public init(red: Double, green: Double, blue: Double, opacity: Double = 1) {}
  public func opacity(_ opacity: Double) -> Color { self }
}

public struct Font: Equatable {
  public static let body = Font()
  public static let caption = Font()
  public static let headline = Font()
  public static let title = Font()
}

public struct Animation: Equatable {
  public static let `default` = Animation()
  public static func spring(response: Double = 0.5, dampingFraction: Double = 0.825) -> Animation {
    Animation()
  }
  public static func easeInOut(duration: Double) -> Animation { Animation() }
}

public enum ColorScheme: Hashable {
  case light, dark
}

public struct EnvironmentValues {
  public var colorScheme: ColorScheme { .light }
}

@propertyWrapper
public struct Environment<Value> {
  public init(_ keyPath: KeyPath<EnvironmentValues, Value>) {}
  public var wrappedValue: Value { EnvironmentValues()[keyPath: keyPath] }
  private var keyPath: KeyPath<EnvironmentValues, Value> { fatalError() }
}

@propertyWrapper
@dynamicMemberLookup
public struct Binding<Value> {
  public var wrappedValue: Value {
    get { get() }
    nonmutating set { set(newValue) }
  }
  private let get: () -> Value
  private let set: (Value) -> Void
  public init(get: @escaping () -> Value, set: @escaping (Value) -> Void) {
    self.get = get
    self.set = set
  }
  public static func constant(_ value: Value) -> Binding<Value> {
    Binding(get: { value }, set: { _ in })
  }
  public var projectedValue: Binding<Value> { self }
  public subscript<T>(dynamicMember keyPath: WritableKeyPath<Value, T>) -> Binding<T> {
    Binding<T>(get: { self.wrappedValue[keyPath: keyPath] }, set: { _ in })
  }
}

public protocol Shape: View {}

public struct Circle: Shape {
  public init() {}
}

public struct Capsule: Shape {
  public init() {}
}

// --- modifiers -----------------------------------------------------------------------

extension View {
  public func padding(_ length: Double) -> some View { self }
  public func frame(width: Double? = nil, height: Double? = nil, alignment: Alignment = .center)
    -> some View
  { self }
  public func font(_ font: Font?) -> some View { self }
  public func foregroundStyle<S: ShapeStyle>(_ style: S) -> some View { self }
  public func background<S: ShapeStyle>(_ style: S) -> some View { self }
  public func opacity(_ opacity: Double) -> some View { self }
  public func scaleEffect(_ s: Double) -> some View { self }
  public func onTapGesture(count: Int = 1, perform action: @escaping () -> Void) -> some View {
    self
  }
  public func onAppear(perform action: (() -> Void)? = nil) -> some View { self }
  public func animation<V>(_ animation: Animation?, value: V) -> some View where V: Equatable {
    self
  }
}

extension Shape {
  public func fill<S: ShapeStyle>(_ content: S) -> some View { self }
}

public func withAnimation<Result>(_ animation: Animation? = .default, _ body: () throws -> Result)
  rethrows -> Result
{
  try body()
}

// --- what generated Swift holds its state in (Combine's and SwiftUI's) ---------------

public protocol ObservableObject: AnyObject {}

@propertyWrapper
public struct Published<Value> {
  public var wrappedValue: Value
  public init(wrappedValue: Value) { self.wrappedValue = wrappedValue }
}

@propertyWrapper
public struct ObservedObject<ObjectType: ObservableObject> {
  public var wrappedValue: ObjectType
  public init(wrappedValue: ObjectType) { self.wrappedValue = wrappedValue }
}

public struct UIHostingControllerSizingOptions: OptionSet {
  public let rawValue: Int
  public init(rawValue: Int) { self.rawValue = rawValue }
  public static let preferredContentSize = UIHostingControllerSizingOptions(rawValue: 1)
}

public struct SafeAreaRegions: OptionSet {
  public let rawValue: UInt
  public init(rawValue: UInt) { self.rawValue = rawValue }
  public static let all = SafeAreaRegions(rawValue: 1)
}

@MainActor
open class UIHostingController<Content: View>: UIViewController {
  public var rootView: Content
  public var sizingOptions: UIHostingControllerSizingOptions = []
  public var safeAreaRegions: SafeAreaRegions = .all
  public init(rootView: Content) {
    self.rootView = rootView
    super.init()
  }
}
