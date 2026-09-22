interface DecisionListener {fun allow(value:Double):Boolean;fun evaluate(value:Double):Double}
class TrackedResource {val value=3.0}
class WeakSDK {var listener:java.lang.ref.WeakReference<DecisionListener>?=null}
typealias ArrayBuffer=ByteArray
{{runtime}}
{{packages}}
{{generated}}

fun main() {
  val sdk=WeakSDK();val owner=make();sdk.listener=java.lang.ref.WeakReference(owner)
  check(sdk.listener!!.get()!!.allow(4.0));check(!sdk.listener!!.get()!!.allow(-1.0))
  check(sdk.listener!!.get()!!.evaluate(3.0)==6.0)
  try {sdk.listener!!.get()!!.evaluate(-1.0);error("error swallowed")} catch(error:LucentError){check(error.code=="NEGATIVE")}
  java.lang.ref.Reference.reachabilityFence(owner)
  println("kotlin: concrete delegate conformance, decisions, retained captures and error policies passed")
}
