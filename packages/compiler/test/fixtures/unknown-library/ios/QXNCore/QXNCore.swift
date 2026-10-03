// A dependency of the library: the unit its gauges measure in. Lucent sees
// it only through QXNKit's signatures.
import Foundation

public final class QXNUnit {
  public let qxnSymbol: String

  public init(qxnSymbol: String) {
    self.qxnSymbol = qxnSymbol
  }

  public func qxnFormat(_ value: Double) -> String {
    "\(value) \(qxnSymbol)"
  }
}
