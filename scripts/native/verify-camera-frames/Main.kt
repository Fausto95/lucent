interface FrameListener {fun analyze(frame:SDKFrame):Double}
class SDKFrame(private val bytes:ByteArray):AutoCloseable {
  companion object {var open=0}
  private var valid=true
  init {open+=1}
  fun sample(index:Double):Double {
    if(!valid) throw LucentError("CLOSED_FRAME")
    if(index<0 || index>=bytes.size || index.toInt().toDouble()!=index) throw LucentError("INVALID_FRAME")
    return (bytes[index.toInt()].toInt() and 255).toDouble()
  }
  override fun close(){if(valid){valid=false;open-=1}}
}
typealias ArrayBuffer=ByteArray
{{runtime}}
{{packages}}
{{generated}}

fun main(){
  val listener=make()
  fun deliver(bytes:ByteArray):Double=SDKFrame(bytes).use{listener.analyze(it)}
  repeat(1000){
    check(deliver(byteArrayOf(10,-1,20,-1,-1,-1,30,-1,40))==25.0)
    check(deliver(byteArrayOf(10)) == -1.0)
    check(SDKFrame.open==0)
  }
  val closed=SDKFrame(byteArrayOf(10));closed.close();closed.close()
  check(listener.analyze(closed) == -1.0 && SDKFrame.open==0)
  println("kotlin: strided Lucent luminance, 1000 valid/malformed frame pairs, closed-frame rejection and zero open frames passed")
}
