// The fixture's implementation: what an installed pod's binary provides.
#import "WLZOrb.h"

@interface WLZHook ()
@property (nonatomic, copy, nullable) void (^pulse)(double);
@property (nonatomic, copy, nullable) void (^failure)(NSError *);
@end

@implementation WLZHook
- (void)detach {
  @synchronized(self) {
    self.pulse = nil;
    self.failure = nil;
  }
}

- (BOOL)attached {
  @synchronized(self) {
    return self.pulse != nil;
  }
}
@end

@implementation WLZOrb {
  NSMutableArray<WLZHook *> *_hooks;
  dispatch_queue_t _queue;
}

- (instancetype)initWithLabel:(NSString *)label {
  if ((self = [super init])) {
    _hooks = [NSMutableArray array];
    _queue = dispatch_queue_create(label.UTF8String, DISPATCH_QUEUE_SERIAL);
  }
  return self;
}

- (WLZHook *)attachPulse:(void (^)(double))pulse failure:(void (^)(NSError *))failure {
  WLZHook *hook = [WLZHook new];
  hook.pulse = pulse;
  hook.failure = failure;
  @synchronized(self) {
    [_hooks addObject:hook];
  }
  return hook;
}

- (NSArray<WLZHook *> *)snapshot {
  @synchronized(self) {
    return [_hooks copy];
  }
}

- (void)emitPulses:(double)count thenBreak:(BOOL)breaks {
  dispatch_async(_queue, ^{
    for (int level = 1; level <= (int)count; level++) {
      for (WLZHook *hook in [self snapshot]) {
        void (^pulse)(double);
        @synchronized(hook) {
          pulse = hook.pulse;
        }
        if (pulse) pulse(level);
      }
    }
    if (!breaks) return;
    NSError *broken = [NSError errorWithDomain:@"WLZOrb" code:7 userInfo:@{NSLocalizedDescriptionKey : @"the orb broke"}];
    for (WLZHook *hook in [self snapshot]) {
      void (^failure)(NSError *);
      @synchronized(hook) {
        failure = hook.failure;
      }
      if (failure) failure(broken);
    }
  });
}

- (double)attachedCount {
  double n = 0;
  for (WLZHook *hook in [self snapshot]) n += hook.attached ? 1 : 0;
  return n;
}
@end
