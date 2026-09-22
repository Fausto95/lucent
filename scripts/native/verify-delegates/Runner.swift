import Foundation
protocol DecisionListener: AnyObject { func allow(_ value:Double)->Bool;func evaluate(input value:Double)throws->Double }
final class TrackedResource { static var live=0; let value=3.0;init(){Self.live+=1};deinit{Self.live-=1} }
final class WeakSDK { weak var listener: (any DecisionListener)? }
typealias ArrayBuffer=[UInt8]
{{runtime}}
{{packages}}
{{generated}}

@main struct Runner {
  static func main() throws {
    let sdk=WeakSDK()
    func exercise() throws {
      let owner=try make()
      sdk.listener=owner
      precondition(TrackedResource.live==1)
      precondition(sdk.listener!.allow(4))
      precondition(!sdk.listener!.allow(-1))
      let doubled=try sdk.listener!.evaluate(input:3)
      precondition(doubled==6)
      do { _ = try sdk.listener!.evaluate(input:-1);fatalError("error swallowed") } catch let error as LucentError { precondition(error.code=="NEGATIVE") }
      withExtendedLifetime(owner) {}
    }
    try exercise()
    precondition(sdk.listener==nil && TrackedResource.live==0)
    print("swift: concrete delegate conformance, decisions, error policies and capture teardown passed")
  }
}
