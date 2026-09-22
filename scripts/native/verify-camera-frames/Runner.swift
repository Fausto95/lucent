import Foundation
protocol FrameListener:AnyObject {func analyze(_ frame:SDKFrame)->Double}
final class SDKFrame {
  static var open=0
  private var valid=true
  private let bytes:[UInt8]
  init(_ bytes:[UInt8]){self.bytes=bytes;Self.open+=1}
  func sample(_ index:Double)throws->Double {
    guard valid else {throw LucentError(code:"CLOSED_FRAME")}
    guard index>=0 && index<Double(bytes.count) && index.rounded(.down)==index else {throw LucentError(code:"INVALID_FRAME")}
    return Double(bytes[Int(index)])
  }
  func close(){if valid {valid=false;Self.open-=1}}
}
typealias ArrayBuffer=[UInt8]
{{runtime}}
{{packages}}
{{generated}}

@main struct Runner {
  static func main() throws {
    let listener=try make()
    func deliver(_ bytes:[UInt8])->Double {
      let frame=SDKFrame(bytes)
      defer {frame.close()}
      return listener.analyze(frame)
    }
    for _ in 0..<1000 {
      precondition(deliver([10,255,20,255,255,255,30,255,40])==25)
      precondition(deliver([10]) == -1)
      precondition(SDKFrame.open==0)
    }
    let closed=SDKFrame([10]);closed.close();closed.close()
    precondition(listener.analyze(closed) == -1 && SDKFrame.open==0)
    print("swift: strided Lucent luminance, 1000 valid/malformed frame pairs, closed-frame rejection and zero open frames passed")
  }
}
