#include "extension.h"

#include <atomic>
#include <cstring>
#include <unordered_map>

namespace lucent {

Handle Handle::open(const char* what, void* pointer, void (*destroy)(void*), ExecutionContext* destroyOn) {
  auto state = std::make_shared<State>();
  state->pointer = pointer;
  state->destroy = destroy;

  // The state owns the resource: the release reaches the state through a raw pointer.
  State* raw = state.get();
  state->resource = Resource::open(String::fromUtf8(what), [raw] { raw->closing(); }, destroyOn);

  Handle h;
  h.state_ = std::move(state);
  return h;
}

void Handle::State::closing() {
  {
    std::lock_guard<std::mutex> lock(mutex);

    if (calls > 0) {
      deferred = true;
      return;
    }
  }

  destroyNow();
}

void Handle::State::release() {
  bool last;
  {
    std::lock_guard<std::mutex> lock(mutex);
    last = --calls == 0 && deferred;
    if (last) deferred = false;
  }

  if (last) destroyNow();
}

void Handle::State::destroyNow() {
  destroy(pointer);

  std::vector<std::function<void()>> after;
  {
    std::lock_guard<std::mutex> lock(mutex);
    destroyed = true;
    after.swap(afterDestroy);
  }

  for (auto& f : after) f();
}

void Handle::whenDestroyed(std::function<void()> f) const {
  if (state_) {
    std::lock_guard<std::mutex> lock(state_->mutex);
    if (!state_->destroyed) {
      state_->afterDestroy.push_back(std::move(f));
      return;
    }
  }

  f();
}

void Handle::acquire() const {
  if (!state_) throwError(String::fromLatin1("InvalidStateError"), String::fromLatin1("the handle is not open"));

  // Checked and counted together: a close either sees this call or refuses it.
  std::lock_guard<std::mutex> lock(state_->mutex);
  state_->resource->check();
  state_->calls++;
}

void Handle::close() const {
  if (state_) state_->resource->close();
}

namespace ext {

void outOfRange(const char* what, const std::string& low, const std::string& high, const std::string& value) {
  throwError(String::fromLatin1("RangeError"),
             String::fromUtf8(std::string(what) + " must be an integer from " + low + " to " + high + ", not " + value));
}

uint8_t* data(Bytes& bytes) {
  static uint8_t none = 0;

  return bytes.size() ? bytes.data() : &none;
}

std::string utf8(const String& s, const char* what) {
  std::string out = s.toUtf8();

  if (out.find('\0') != std::string::npos)
    throwError(String::fromLatin1("TypeError"),
               String::fromUtf8(std::string(what) + " holds a NUL character, which a C string cannot"));

  return out;
}

static Error failure(const char* function, const char* message) {
  bool has = message && *message;

  return makeError(has ? String::fromUtf8(std::string_view(message, std::strlen(message)))
                       : String::fromUtf8(std::string(function) + " failed"));
}

void fail(const char* function, const char* message) { throwError(failure(function, message)); }

void fail(const char* function, const char* message, long long code) {
  Error e = failure(function, message);
  e->code = String::fromUtf8(std::to_string(code));
  throwError(e);
}

std::string cxxString(const String& s) { return s.toUtf8(); }

String fromCxx(std::string_view s) { return String::fromUtf8(s); }

void cxxThrew(const char* what, const char* message) {
  throwError(makeError(message ? String::fromUtf8(std::string_view(message, std::strlen(message)))
                               : String::fromUtf8(std::string(what) + " threw a C++ exception")));
}

// --- signals -----------------------------------------------------------------------------

SignalFlag::SignalFlag(const Opt<AbortSignal>& signal) : signal_(signal.has() ? signal.get() : nullptr) {
  if (signal_ && signal_->requested.load()) throwError(signal_->requestedReason());
}

const std::atomic<bool>& SignalFlag::flag() const {
  static const std::atomic<bool> never{false};
  return signal_ ? signal_->requested : never;
}

void SignalFlag::done() const {
  if (signal_ && signal_->requested.load()) throwError(signal_->requestedReason());
}

// --- callbacks ---------------------------------------------------------------------------

detail::CallFrame*& detail::CallFrame::innermost() {
  thread_local CallFrame* frame = nullptr;
  return frame;
}

void detail::thrownAtOnce(std::exception_ptr e) {
  if (CallFrame* frame = CallFrame::innermost())
    frame->threw(std::move(e));
  else
    reportUncaught(std::move(e), "callback");
}

CallbackState::CallbackState(const char* what, Lives lives)
    : what_(what), lives_(lives), owner_(ExecutionContext::currentRef()), scope_(ownedScope(owner_)) {}

void CallbackState::post(Job job) { context().post(std::move(job), scope_); }

void CallbackState::refuse() {
  {
    std::lock_guard<std::mutex> lock(mutex_);
    if (during_) {
      refused_ = true;
      return;
    }
  }

  try {
    throwRefusal();
  } catch (...) {
    reportUncaught(std::current_exception(), "callback");
  }
}

void CallbackState::returned() {
  std::lock_guard<std::mutex> lock(mutex_);
  during_ = false;
}

void CallbackState::rethrow() {
  bool refused;
  {
    std::lock_guard<std::mutex> lock(mutex_);
    refused = std::exchange(refused_, false);
  }

  if (refused) throwRefusal();
}

void CallbackState::throwRefusal() const {
  throwError(makeError(String::fromUtf8(
      std::string(what_) +
      " was called from another thread for its result, which only a call on its context's thread can give")));
}

namespace {

/// The callbacks C reaches through a `void *`: by token, never reused.
struct Registered {
  std::shared_ptr<CallbackState> state;
  std::weak_ptr<Scope> scope;
  Scope::CleanupId cleanup = 0;
};

std::mutex registryMutex;

std::unordered_map<uintptr_t, Registered>& registry() {
  // Never destroyed: C may call a callback while the process exits.
  static auto* r = new std::unordered_map<uintptr_t, Registered>();
  return *r;
}

std::atomic<uintptr_t> nextToken{1};

}  // namespace

void* registerCallback(std::shared_ptr<CallbackState> state, bool withScope) {
  const uintptr_t token = nextToken.fetch_add(1, std::memory_order_relaxed);
  void* context = reinterpret_cast<void*>(token);
  std::shared_ptr<Scope> scope = withScope ? state->scope() : nullptr;

  {
    std::lock_guard<std::mutex> lock(registryMutex);
    registry().emplace(token, Registered{std::move(state), {}, 0});
  }

  if (scope) {
    // A scope already disposed runs the cleanup now: the callback ends at once.
    Scope::CleanupId id = scope->onDispose([context] { endCallback(context); });
    if (id) {
      bool kept = false;
      {
        std::lock_guard<std::mutex> lock(registryMutex);
        auto it = registry().find(token);
        if (it != registry().end()) {
          it->second.scope = scope;
          it->second.cleanup = id;
          kept = true;
        }
      }
      if (!kept) scope->remove(id);
    }
  }

  return context;
}

std::shared_ptr<CallbackState> registeredCallback(void* context) {
  std::lock_guard<std::mutex> lock(registryMutex);
  auto it = registry().find(reinterpret_cast<uintptr_t>(context));
  return it == registry().end() ? nullptr : it->second.state;
}

void endCallback(void* context) {
  Registered ended;
  {
    std::lock_guard<std::mutex> lock(registryMutex);
    auto it = registry().find(reinterpret_cast<uintptr_t>(context));
    if (it == registry().end()) return;
    ended = std::move(it->second);
    registry().erase(it);
  }

  if (ended.cleanup)
    if (auto scope = ended.scope.lock()) scope->remove(ended.cleanup);
  // The state goes here, outside the lock: its Lucent function is released on its context.
}

}  // namespace ext
}  // namespace lucent
