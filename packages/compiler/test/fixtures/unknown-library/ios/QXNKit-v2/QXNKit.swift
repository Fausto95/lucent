// QXNKit's next version: qxnBump(_:) is gone, qxnMove(by:) and qxnReset()
// are new, and everything else is as it was.
import Foundation
import QXNCore

/// What the library's callers implement to hear from a gauge.
public protocol QXNListener: AnyObject {
  func qxnChanged(_ level: Double)
}

public enum QXNFailure: Error {
  case qxnNegative
}

open class QXNBase {
  public let qxnLabel: String

  public init(qxnLabel: String) {
    self.qxnLabel = qxnLabel
  }

  open func qxnDescribe() -> String {
    "base \(qxnLabel)"
  }
}

public final class QXNGauge: QXNBase {
  public private(set) var qxnLevel: Double
  public var qxnListener: QXNListener?

  public init(qxnLabel: String, qxnLevel: Double) {
    self.qxnLevel = qxnLevel
    super.init(qxnLabel: qxnLabel)
  }

  public override func qxnDescribe() -> String {
    "gauge \(qxnLabel) at \(qxnLevel)"
  }

  /// Moves the level, and tells the listener.
  public func qxnMove(by delta: Double) {
    qxnLevel += delta
    qxnListener?.qxnChanged(qxnLevel)
  }

  /// Back to zero, unheard.
  public func qxnReset() {
    qxnLevel = 0
  }

  /// The unit, a type the library's dependency declares.
  public func qxnUnit() -> QXNUnit {
    QXNUnit(qxnSymbol: "qxn")
  }

  /// Tuples: arrays in Lucent, labeled as Swift labels them.
  public func qxnRange() -> (Double, Double) {
    (0, qxnLevel)
  }

  public func qxnClamp(_ range: (low: Double, high: Double)) -> (level: Double, label: String) {
    (min(max(qxnLevel, range.low), range.high), qxnLabel)
  }

  /// Shapes Lucent does not bind yet: an inout parameter, and a function taking an enum.
  public func qxnSwap(_ other: inout Double) {
    swap(&qxnLevel, &other)
  }

  public func qxnOnFailure(_ handler: @escaping (QXNFailure) -> Void) {}

  public func qxnWatcher() -> () -> Double {
    { self.qxnLevel }
  }

  public func qxnEach(_ steps: [Double], _ body: (Double, String) -> String) -> [String] {
    steps.map { body($0, qxnLabel) }
  }

  public var qxnOnShift: ((Double) -> Void)?

  public func qxnShift(by delta: Double) {
    qxnLevel += delta
    qxnOnShift?(qxnLevel)
  }

  /// Twice the level, a moment later; fails below zero.
  public func qxnMeasure() async throws -> Double {
    try await Task.sleep(nanoseconds: 1_000_000)
    if qxnLevel < 0 { throw QXNFailure.qxnNegative }
    return qxnLevel * 2
  }
}

/// A generic wrapper: one item of any type.
public final class QXNBox<Item> {
  public let qxnItem: Item

  public init(_ qxnItem: Item) {
    self.qxnItem = qxnItem
  }
}
