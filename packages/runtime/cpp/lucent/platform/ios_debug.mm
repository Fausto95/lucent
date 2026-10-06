// Lucent runtime — the iOS view tree a debug build's snapshot shows (T61,
// view.h debugSnapshot): each view's class, frame (points, in its
// superview) and children, hidden ones marked. The host installs it.
#import <UIKit/UIKit.h>

#include <cstdio>
#include <string>

#include "../view.h"
#include "ios.h"

namespace {

std::string number(CGFloat v) {
  char out[32];
  std::snprintf(out, sizeof out, "%g", static_cast<double>(v));
  return out;
}

void write(std::string& out, UIView* view) {
  const CGRect f = view.frame;

  out += "{\"class\":\"";
  out += NSStringFromClass(view.class).UTF8String;
  out += "\",\"frame\":[" + number(f.origin.x) + "," + number(f.origin.y) + "," + number(f.size.width) + "," +
         number(f.size.height) + "]";
  if (view.hidden) out += ",\"hidden\":true";

  if (view.subviews.count) {
    out += ",\"children\":[";
    bool first = true;
    for (UIView* child in view.subviews) {
      if (!first) out += ",";
      write(out, child);
      first = false;
    }
    out += "]";
  }

  out += "}";
}

}  // namespace

namespace lucent::objc {

void installViewTree() {
  ui::setViewTree([](const NativeRef& ref) {
    std::string out;
    write(out, (UIView*)unwrap(ref));
    return out;
  });
}

}  // namespace lucent::objc
