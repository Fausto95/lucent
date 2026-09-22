import Foundation

func lucentNative_NativeText__create(value: String) throws -> NSString {
  return NSString(string: value)
}

func lucentNative_NativeText__get_length(lucentSelf: NSString) throws -> Double {
  return Double(lucentSelf.length)
}
