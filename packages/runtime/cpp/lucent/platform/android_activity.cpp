// Lucent runtime — Android: the app's Activities for Lucent code (the
// current one, activity results, permissions, lifecycle events), through
// dev.lucent.LucentActivities. Built only into Android apps.
#ifdef __ANDROID__

#include <array>
#include <cstdint>
#include <map>
#include <mutex>
#include <string>
#include <utility>
#include <vector>

#include "android.h"
#include "android_requests.h"

namespace lucent::jni {

namespace {

/// Lifecycle events, numbered as LucentActivities numbers them.
constexpr std::array<const char*, 7> kEvents = {"created", "started", "resumed", "paused", "stopped", "destroyed", "newIntent"};

jclass activities();

void forgetOnPlatform(OperationId id) {
  JNIEnv* e = env();
  static jmethodID forget = staticMethod(activities(), "forget", "(J)V");

  e->CallStaticVoidMethod(activities(), forget, static_cast<jlong>(id));
  check(e);
}

Requests<NativeRef>& results() {
  static auto* requests = new Requests<NativeRef>(forgetOnPlatform);
  return *requests;
}

Requests<Array<bool>>& permissionRequests() {
  static auto* requests = new Requests<Array<bool>>(forgetOnPlatform);
  return *requests;
}

/// What each permission request asked for, to answer in its order.
std::mutex askedMutex;
std::map<OperationId, Array<String>>& asked() {
  static auto* m = new std::map<OperationId, Array<String>>();
  return *m;
}

struct Subscription {
  size_t event;
  ActivityHandler handler;
  /// Where the handler runs: the context that subscribed.
  ContextRef context;
};

std::mutex subscriptionsMutex;
std::map<uint64_t, Subscription>& subscriptions() {
  static auto* m = new std::map<uint64_t, Subscription>();
  return *m;
}

/// Runs a native method's body; a Lucent error is reported, never thrown into Java.
template <class F>
void guarded(const char* what, F f) {
  try {
    f();
  } catch (...) {
    reportUncaught(std::current_exception(), what);
  }
}

void JNICALL onResult(JNIEnv* e, jclass, jlong id, jint resultCode, jobject data) {
  guarded("activity result", [&] {
    LocalFrame frame(e);
    jclass cls = findClass("android/app/Instrumentation$ActivityResult");
    static jmethodID init = method(cls, "<init>", "(ILandroid/content/Intent;)V");

    NativeRef result = wrap(e, e->NewObject(cls, init, resultCode, data), "Instrumentation.ActivityResult");
    results().deliver(static_cast<OperationId>(id), std::move(result));
  });
}

void JNICALL onPermissions(JNIEnv* e, jclass, jlong id, jobjectArray permissions, jintArray grants) {
  guarded("permission result", [&] {
    Array<String> requested;
    {
      std::lock_guard<std::mutex> g(askedMutex);
      auto it = asked().find(static_cast<OperationId>(id));
      if (it == asked().end()) return;

      requested = it->second;
      asked().erase(it);
    }

    // A dismissed dialog answers with nothing: none granted.
    std::map<std::u16string, bool> granted;
    if (permissions && grants) {
      Array<String> names = fromStringArray(e, permissions, "permissions");
      Array<double> codes = fromIntArray(e, grants, "grants");

      for (size_t i = 0; i < names.size() && i < codes.size(); i++)
        granted[names.at(i).toUtf16()] = codes.at(i) == 0;  // PackageManager.PERMISSION_GRANTED
    }

    Array<bool> answer;
    for (size_t i = 0; i < requested.size(); i++) {
      auto it = granted.find(requested.at(i).toUtf16());
      answer.push(it != granted.end() && it->second);
    }

    permissionRequests().deliver(static_cast<OperationId>(id), std::move(answer));
  });
}

void JNICALL onFailed(JNIEnv* e, jclass, jlong id, jstring code, jstring message) {
  guarded("activity request", [&] {
    Error error = makeError(fromJString(e, message, "message"));
    error->code = fromJString(e, code, "code");
    auto op = static_cast<OperationId>(id);

    if (!results().fail(op, error)) permissionRequests().fail(op, error);

    std::lock_guard<std::mutex> g(askedMutex);
    asked().erase(op);
  });
}

void JNICALL onEvent(JNIEnv* e, jclass, jint kind, jobject activity, jobject intent) {
  guarded("activity event", [&] {
    std::vector<Subscription> matching;
    {
      std::lock_guard<std::mutex> g(subscriptionsMutex);
      for (const auto& [id, s] : subscriptions())
        if (s.event == static_cast<size_t>(kind)) matching.push_back(s);
    }

    if (matching.empty()) return;

    // Global references, released on whatever thread drops the last one.
    NativeRef a = wrap(e, e->NewLocalRef(activity), "Activity");
    Opt<NativeRef> i = wrapOpt(e, intent ? e->NewLocalRef(intent) : nullptr);

    // A turn of the subscribing context (the legacy module context's holds the Lucent lock).
    for (auto& s : matching)
      ExecutionContext::of(s.context).post([handler = s.handler, a, i] {
        try {
          handler(a, i);
        } catch (...) {
          reportUncaught(std::current_exception(), "activity event handler");
        }
      });
  });
}

jclass activities() {
  static jclass cls = [] {
    JNIEnv* e = env();
    jclass c = findClass("dev/lucent/LucentActivities");
    JNINativeMethod natives[] = {
        {const_cast<char*>("onResult"), const_cast<char*>("(JILandroid/content/Intent;)V"), reinterpret_cast<void*>(onResult)},
        {const_cast<char*>("onPermissions"), const_cast<char*>("(J[Ljava/lang/String;[I)V"), reinterpret_cast<void*>(onPermissions)},
        {const_cast<char*>("onFailed"), const_cast<char*>("(JLjava/lang/String;Ljava/lang/String;)V"), reinterpret_cast<void*>(onFailed)},
        {const_cast<char*>("onEvent"), const_cast<char*>("(ILandroid/app/Activity;Landroid/content/Intent;)V"), reinterpret_cast<void*>(onEvent)},
    };
    e->RegisterNatives(c, natives, 4);
    check(e);
    return c;
  }();
  return cls;
}

/// The scope a request belongs to: the calling context's root.
std::shared_ptr<Scope> requestScope() {
  ExecutionContext* context = ExecutionContext::current();
  return (context ? *context : ExecutionContext::legacy()).root();
}

}  // namespace

Opt<NativeRef> currentActivity() {
  JNIEnv* e = env();
  static jmethodID current = staticMethod(activities(), "current", "()Landroid/app/Activity;");

  jobject a = e->CallStaticObjectMethod(activities(), current);
  check(e);
  return wrapOpt(e, a);
}

Promise<NativeRef> startActivityForResult(const NativeRef& intent, Opt<AbortSignal> signal) {
  return results().start(requestScope(), std::move(signal), [&](OperationId id) {
    JNIEnv* e = env();
    static jmethodID start = staticMethod(activities(), "startForResult", "(JLandroid/content/Intent;)V");

    e->CallStaticVoidMethod(activities(), start, static_cast<jlong>(id), unwrap(intent));
    check(e);
  });
}

Promise<Array<bool>> requestPermissions(const Array<String>& permissions, Opt<AbortSignal> signal) {
  return permissionRequests().start(requestScope(), std::move(signal), [&](OperationId id) {
    {
      std::lock_guard<std::mutex> g(askedMutex);
      asked()[id] = permissions;
    }

    JNIEnv* e = env();
    LocalFrame frame(e);
    static jmethodID request = staticMethod(activities(), "requestPermissions", "(J[Ljava/lang/String;)V");

    e->CallStaticVoidMethod(activities(), request, static_cast<jlong>(id), toStringArray(e, permissions));
    check(e);
  });
}

Fn<void()> onActivityEvent(const String& event, ActivityHandler handler) {
  std::string name = event.toUtf8();
  size_t kind = 0;
  while (kind < kEvents.size() && name != kEvents[kind]) kind++;
  if (kind == kEvents.size()) throwTypeError(("Unknown Activity event: " + name).c_str());

  static std::atomic<uint64_t> next{1};
  uint64_t id = next++;

  bool first;
  {
    std::lock_guard<std::mutex> g(subscriptionsMutex);
    first = subscriptions().empty();
    subscriptions().emplace(id, Subscription{kind, std::move(handler), ExecutionContext::currentRef()});
  }

  JNIEnv* e = env();
  static jmethodID listen = staticMethod(activities(), "listen", "(Z)V");
  if (first) {
    e->CallStaticVoidMethod(activities(), listen, JNI_TRUE);
    check(e);
  }

  return Fn<void()>([id] {
    bool last;
    {
      std::lock_guard<std::mutex> g(subscriptionsMutex);
      if (!subscriptions().erase(id)) return;
      last = subscriptions().empty();
    }

    if (last) {
      JNIEnv* env_ = env();
      env_->CallStaticVoidMethod(activities(), listen, JNI_FALSE);
      check(env_);
    }
  });
}

}  // namespace lucent::jni

#endif  // __ANDROID__
