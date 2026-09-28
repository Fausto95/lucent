// The floor for scripts/bench.ts: add() and concat() as bare JSI host
// functions, converting their arguments and results the way React Native's
// codegen has a C++ TurboModule do it (asNumber; std::string through utf8
// and createFromUtf8). Installed as __floor by the harness's hook, with
// __now, a high-resolution clock for single-call latencies.
#include <jsi/jsi.h>

#include <chrono>
#include <string>

namespace jsi = facebook::jsi;

void installHarnessExtras(jsi::Runtime& rt) {
  jsi::Object floor(rt);
  floor.setProperty(rt, "add",
                    jsi::Function::createFromHostFunction(rt, jsi::PropNameID::forAscii(rt, "add"), 2,
                                                          [](jsi::Runtime&, const jsi::Value&, const jsi::Value* args, size_t) {
                                                            return jsi::Value(args[0].asNumber() + args[1].asNumber());
                                                          }));
  floor.setProperty(rt, "concat",
                    jsi::Function::createFromHostFunction(rt, jsi::PropNameID::forAscii(rt, "concat"), 2,
                                                          [](jsi::Runtime& rt, const jsi::Value&, const jsi::Value* args, size_t) {
                                                            std::string a = args[0].asString(rt).utf8(rt);
                                                            std::string b = args[1].asString(rt).utf8(rt);
                                                            return jsi::Value(jsi::String::createFromUtf8(rt, a + b));
                                                          }));
  rt.global().setProperty(rt, "__floor", floor);

  // A monotonic clock in milliseconds with sub-microsecond resolution, for
  // timing single calls (Date.now() counts whole milliseconds).
  rt.global().setProperty(rt, "__now",
                          jsi::Function::createFromHostFunction(rt, jsi::PropNameID::forAscii(rt, "__now"), 0,
                                                                [](jsi::Runtime&, const jsi::Value&, const jsi::Value*, size_t) {
                                                                  auto t = std::chrono::steady_clock::now().time_since_epoch();
                                                                  return jsi::Value(std::chrono::duration<double, std::milli>(t).count());
                                                                }));
}
