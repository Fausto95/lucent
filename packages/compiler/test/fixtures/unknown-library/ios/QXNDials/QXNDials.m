#import "QXNDials.h"

@implementation QXNDial

- (void)qxnTurn:(double)delta {
  self.qxnLevel += delta;
  if (self.qxnOnTurn) self.qxnOnTurn(self.qxnLevel);
}

@end
