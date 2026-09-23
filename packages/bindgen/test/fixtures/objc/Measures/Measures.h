#import <Foundation/Foundation.h>

// Declared as the SDK's C frameworks declare theirs: attributes after the
// name, plain typedefs, structs with a tag.
typedef int32_t MSRTrackID;

typedef struct {
  int64_t value;
  int32_t scale;
} MSRTime API_AVAILABLE(ios(4.0), macos(10.7));

typedef struct __attribute__((objc_boxable)) MSRSpan MSRSpan;
struct MSRSpan {
  MSRTime start;
  MSRTime duration;
};

// A typedef of a struct whose tag Swift hides, as NSRange's `_NSRange`.
typedef struct _MSRRange {
  NSUInteger location;
  NSUInteger length;
} MSRRange;
