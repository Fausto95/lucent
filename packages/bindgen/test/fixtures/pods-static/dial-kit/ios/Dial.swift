import Foundation

public class Gauge {
  public var value: Double
  public init(value: Double) { self.value = value }
  public func fill(to level: Double) -> Double { value = level; return value }
}
