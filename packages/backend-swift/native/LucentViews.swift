import SwiftUI
/** Row identity for a keyed `For`. A duplicate key is a programming error, so it is
 * reported in debug builds and then disambiguated by position rather than dropping a row. */
struct LucentKeyedRow<Value>: Identifiable {
  let id: String
  let value: Value
}

func lucentKeyedRows<Value>(_ values: [Value], _ key: (Value) throws -> String) -> [LucentKeyedRow<Value>] {
  var seen = Set<String>()
  var rows: [LucentKeyedRow<Value>] = []
  for (index, value) in values.enumerated() {
    let raw = (try? key(value)) ?? String(index)
    var id = raw
    if seen.contains(id) {
      assertionFailure("Lucent: duplicate view key \(raw)")
      id = "\(raw)#\(index)"
    }
    seen.insert(id)
    rows.append(LucentKeyedRow(id: id, value: value))
  }
  return rows
}

func lucentViewColor(_ value: String) -> Color {
  let hex = value.hasPrefix("#") ? String(value.dropFirst()) : value
  guard hex.count == 6, let rgb = UInt32(hex, radix: 16) else { return .primary }
  return Color(red: Double((rgb >> 16) & 255) / 255, green: Double((rgb >> 8) & 255) / 255, blue: Double(rgb & 255) / 255)
}
