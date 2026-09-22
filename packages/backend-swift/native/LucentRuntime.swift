import Foundation

{{error}}

{{errorWire}}

enum LucentBytes {
  static func data(_ buffer: ArrayBuffer) -> Data {
    {{bytesData}}
  }
  static func fromData(_ data: Data) throws -> ArrayBuffer {
    {{bytesFromData}}
  }
  static func length(_ buffer: ArrayBuffer) -> Double {
    {{bytesLength}}
  }

  static func get(_ buffer: ArrayBuffer, _ index: Double) -> Double {
    {{bytesGet}}
  }
}

func lucentStr(_ value: Double) -> String {
  if value.isFinite && value == value.rounded() && abs(value) < 1e15 {
    return String(Int64(value))
  }
  return String(value)
}

func lucentStr(_ value: Float) -> String {
  return lucentStr(Double(value))
}

func lucentStr<T: BinaryInteger>(_ value: T) -> String {
  return String(value)
}

func lucentStr(_ value: Bool) -> String {
  return value ? "true" : "false"
}
