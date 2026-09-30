// A native listener API with names nothing in Lucent knows: it reports
// pulses through blocks, on a queue of its own, until a hook detaches.
#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

/// Stops a listener. Detaching twice does nothing.
@interface WLZHook : NSObject
- (void)detach;
@property (nonatomic, readonly) BOOL attached;
@end

@interface WLZOrb : NSObject
- (instancetype)initWithLabel:(NSString *)label;

/// Calls `pulse` with each level, and `failure` if the orb breaks, on the
/// orb's queue, until the hook detaches.
- (WLZHook *)attachPulse:(void (^)(double level))pulse failure:(void (^)(NSError *error))failure;

/// Reports the levels 1 to `count` from the orb's queue, then breaks if
/// `breaks`. Detached listeners are skipped.
- (void)emitPulses:(double)count thenBreak:(BOOL)breaks;

/// Listeners still attached.
@property (nonatomic, readonly) double attachedCount;
@end

NS_ASSUME_NONNULL_END
