import Foundation

/// A Swift module with no Objective-C in it: every member is Swift-only.
public struct Point {
  public var x: Double
  public var y: Double
  public init(x: Double, y: Double) {
    self.x = x
    self.y = y
  }
  public func distance(to other: Point) -> Double {
    ((x - other.x) * (x - other.x) + (y - other.y) * (y - other.y)).squareRoot()
  }
  public static let origin = Point(x: 0, y: 0)
}

extension Point: Equatable {}

public enum Shape {
  case circle(center: Point, radius: Double)
  case square(side: Double)
}

extension Shape {
  public var sides: Int {
    if case .square = self { return 4 }
    return 0
  }
}

/// Cases without labels, and one without a payload.
public enum Stroke {
  case none
  case solid(Double)
  case dashed(Double, Double)
  case custom(name: String?, width: Double)
}

public enum Palette {
  case red, green, blue
}

public final class Canvas {
  public init() {}
  public init<S: Sequence>(shapes: S) where S.Element == Shape { self.shapes = Array(shapes) }
  public private(set) var shapes: [Shape] = []
  public func add(_ shape: Shape) { shapes.append(shape) }
  public func area() async throws -> Double { 0 }
}

public protocol Drawable {
  func draw() -> String
}

/// Takes the standard protocols Lucent values conform to.
public enum Checksum {
  public static func of(_ data: some DataProtocol) -> Int { data.count }
  public static func joined(_ names: some Collection<String>) -> String { names.joined() }
}

/// Bytes a program reads out.
public struct Token: ContiguousBytes {
  public init() {}
  public func withUnsafeBytes<R>(_ body: (UnsafeRawBufferPointer) throws -> R) rethrows -> R {
    try [UInt8](repeating: 7, count: 4).withUnsafeBytes(body)
  }
}

public func identity<T>(_ value: T) -> T { value }

/// Shapes Lucent cannot declare: its members are skipped, not declared half-typed.
public struct Box<Value> {
  public var value: Value
  public init(value: Value) { self.value = value }
  public static func empty() -> Box<Value>? { nil }
  public func each<each T>(_ values: repeat each T) -> Int { 0 }
}

struct Hidden {}

public struct Uses {
  public init() {}
  public init<T>(tag: T) {}
  /// A Box of a type Lucent binds: fine.
  public func boxed() -> Box<Point> { Box(value: .origin) }
}

/// An enum whose payload Lucent cannot type: not declared, so neither is what names it.
public enum Broken {
  case raw(UnsafeRawPointer)
}

public func broken() -> Broken? { nil }

/// What a program calls synchronously: enums, optionals, arrays, errors, statics.
public final class Pen {
  public var color: Palette
  public var label: String?
  public var outline: Stroke = .none
  public init(color: Palette) { self.color = color }
  public func mix(_ other: Palette) -> Palette { other == color ? color : .blue }
  public func stroke(from start: Point, to end: Point) -> [Point] { [start, end] }
  public static func parse(_ text: String) throws -> Pen {
    guard let i = ["red", "green", "blue"].firstIndex(of: text) else { throw PenError.unknown }
    return Pen(color: [Palette.red, .green, .blue][i])
  }
}

public enum PenError: Error {
  case unknown
}

/// A value a program changes in place.
public struct Counter {
  public private(set) var count = 0
  public init() {}
  public mutating func increment() { count += 1 }
  /// Writes back through its argument: no Lucent argument is a place to write to.
  public func add(into total: inout Int) { total += count }
}

/// Main-thread only, as UIKit is.
@MainActor public final class Screen {
  public var title = "home"
  public var ready: Bool {
    get async { true }
  }
  public init() {}
  public func show(_ name: String) async -> Bool {
    title = name
    return true
  }
}

/// Points, later; none for a negative count.
public func fetch(_ count: Int) async throws -> [Point] {
  guard count >= 0 else { throw PenError.unknown }
  return Array(repeating: Point(x: 1, y: 2), count: count)
}

/// A generic enum with payloads.
public enum Outcome<T> {
  case done(T)
  case failed(String)
}

public func attempt(_ ok: Bool) -> Outcome<Double> { ok ? .done(1) : .failed("no") }

/// Takes any drawable: a Swift protocol value.
public func render(_ d: Drawable) -> String { d.draw() }

public final class Circle: Drawable {
  public init() {}
  public func draw() -> String { "circle" }
}

/// A protocol value, from Swift.
public func favorite() -> Drawable { Circle() }

/// Requirements with an associated type: not implementable from Lucent yet.
public protocol Container {
  associatedtype Item
  func first() -> Item?
}

/// Members a protocol extension gives the types that conform to it.
public protocol Accumulator {
  associatedtype Output
  init()
  mutating func feed(_ n: Int)
  func output() -> Output
}

extension Accumulator {
  public static func total(of n: Int) -> Output {
    var a = Self()
    a.feed(n)
    return a.output()
  }
}

public struct Summer: Accumulator {
  public typealias Output = Double
  var sum = 0
  public init() {}
  public init<D: ContiguousBytes>(seed: D) { seed.withUnsafeBytes { sum = $0.count } }
  public mutating func feed(_ n: Int) { sum += n }
  public func output() -> Double { Double(sum) }
}

/// Two protocols whose extensions give the same property, and a type that declares it too.
public protocol Labeled {}
extension Labeled {
  public static var kind: String { "labeled" }
}

public protocol Tagged {}
extension Tagged {
  public static var kind: String { "tagged" }
}

public struct Badge: Labeled, Tagged {
  public init() {}
  public static var kind: String { "badge" }
}

/// A generic enum whose payload names a type nested in it, as StoreKit's VerificationResult.
public enum Verified<Signed> {
  case verified(Signed)
  case unverified(Signed, Verified<Signed>.Failure)

  public enum Failure {
    case revoked, invalid
  }
}

public func verify(_ ok: Bool) -> Verified<Point> {
  ok ? .verified(Point(x: 1, y: 1)) : .unverified(Point(x: 0, y: 0), .invalid)
}

/// Default arguments: one a call may leave out, one Lucent cannot give (isolation).
public func greet(_ name: String, punctuation: String = "!", isolation: isolated (any Actor)? = #isolation) async -> String {
  "hi \(name)\(punctuation)"
}

/// A collection constrained by its element (StoreKit's products(for:)).
public func countNames<Names: Collection>(_ names: Names) -> Int where Names.Element == String {
  names.count
}

/// A key whose statics fix its type parameter (AVFoundation's AVPartialAsyncProperty<Root>.duration).
public final class Key<Root> {
  init() {}
}

extension Key where Root: Canvas {
  public static var area: Key<Root> { Key() }
}

public func read(_ key: Key<Canvas>) -> String { "area" }

/// C structs, by value.
public func midpoint(_ a: CGPoint, _ b: CGPoint) -> CGPoint {
  CGPoint(x: (a.x + b.x) / 2, y: (a.y + b.y) / 2)
}
