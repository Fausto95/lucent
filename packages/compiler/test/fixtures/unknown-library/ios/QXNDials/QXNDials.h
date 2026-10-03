// A view Lucent has never seen: a dial with a level, which calls a block when
// it is turned. Its names are drawn at random on every run ("QXN"/"qxn").
#import <UIKit/UIKit.h>

NS_ASSUME_NONNULL_BEGIN

@interface QXNDial : UIView

@property (nonatomic) double qxnLevel;

/// Called with the new level whenever the dial is turned.
@property (nonatomic, copy, nullable) void (^qxnOnTurn)(double level);

/// Turns the dial by `delta`, as a user would.
- (void)qxnTurn:(double)delta;

@end

NS_ASSUME_NONNULL_END
