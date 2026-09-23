#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

typedef NS_ENUM(NSInteger, WPGaugeMode) {
  WPGaugeModeLinear,
  WPGaugeModeRadial = 4,
};

@interface WPGauge : NSObject
- (instancetype)initWithMode:(WPGaugeMode)mode;
@property (nonatomic) double value;
@property (nonatomic, readonly) NSURL *documentation;
@end

NS_ASSUME_NONNULL_END
