typealias ArrayBuffer = [UInt8]
{{runtime}}
{{packages}}
{{generated}}

@main struct Runner {
  static func main() throws {
    precondition(try! lowLevel() == 1)
    precondition(try! preferred(quality: LucentEnum_Quality.fromLucent("high")) == 2)
    precondition(try! LucentEnum_Quality.toLucent(chosen()) == "high")
    precondition(try! isBest())
    do { _ = try LucentEnum_Quality.fromLucent("ultra"); fatalError("Unknown case accepted") }
    catch let error as LucentError { precondition(error.code == "INVALID_ENUM_CASE") }
    print("swift: SDK enum cases, boundary conversion and unknown-case rejection passed")
  }
}
