#include "extension.h"

#include <cstring>

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

  destroy(pointer);
}

void Handle::State::release() {
  bool last;
  {
    std::lock_guard<std::mutex> lock(mutex);
    last = --calls == 0 && deferred;
    if (last) deferred = false;
  }

  if (last) destroy(pointer);
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

}  // namespace ext
}  // namespace lucent
