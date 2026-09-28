// The UIKit glue (lucent/platform/ios_ui.h) as generated units use it,
// compiled against the iOS simulator SDK: UIKit has no macOS host to run
// it on, so run.sh checks that it compiles, and the example apps' SDK
// probes run it on the simulator.
#include "lucent/lucent.h"
#include "lucent/platform/ios_ui.h"

using namespace lucent;

// present<T>: a value, none, and an optional one.
Promise<double> presentsNumber(Fn<NativeRef(Fn<void(double)>, Fn<void(Error)>)> build, Opt<AbortSignal> signal) {
  return objc::present<double>(std::move(build), std::move(signal));
}

Promise<void> presentsNothing(Fn<NativeRef(Fn<void()>, Fn<void(Error)>)> build) { return objc::present<void>(std::move(build)); }

Promise<Opt<String>> presentsOptional(Fn<NativeRef(Fn<void(Opt<String>)>, Fn<void(Error)>)> build) {
  return objc::present<Opt<String>>(std::move(build));
}

// For native wrappers: the context now, and an operation under a scope.
std::shared_ptr<Operation<bool>> wrapperPresents(const std::shared_ptr<Scope>& scope) {
  std::optional<objc::PresentationContext> context = objc::presentationContext();
  if (context && context->top.view.window != context->window) return nullptr;

  return objc::presentOperation<bool>(scope, {}, [](const std::shared_ptr<Operation<bool>>& op) -> UIViewController* {
    UIAlertController* alert = [UIAlertController alertControllerWithTitle:@"Lucent" message:nil preferredStyle:UIAlertControllerStyleAlert];
    std::weak_ptr<Operation<bool>> weak = op;
    [alert addAction:[UIAlertAction actionWithTitle:@"OK"
                                              style:UIAlertActionStyleDefault
                                            handler:^(UIAlertAction*) {
                                              if (auto op = weak.lock()) op->succeed(true);
                                            }]];
    return alert;
  });
}

// Lifecycle subscriptions, stopped by the function they return or a signal.
Fn<void()> followsTheApp(Fn<void()> listener, Opt<AbortSignal> signal) {
  return objc::onAppEvent(String::fromLatin1("didEnterBackground"), std::move(listener), std::move(signal));
}

Fn<void()> followsScenes(Fn<void(String)> listener) { return objc::onSceneEvent(String::fromLatin1("didActivate"), std::move(listener)); }
