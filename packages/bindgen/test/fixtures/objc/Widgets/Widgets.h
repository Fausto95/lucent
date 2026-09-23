#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

typedef NS_ENUM(NSInteger, WDGStyle) {
  WDGStyleLight,
  WDGStyleMedium,
  WDGStyleHeavy = 10,
  WDGStyleRigid,
};

typedef NS_OPTIONS(NSUInteger, WDGEdges) {
  WDGEdgesTop = 1 << 0,
  WDGEdgesBottom = 1 << 1,
};

typedef NSString *WDGKey NS_TYPED_ENUM;
extern WDGKey const WDGKeyName;

extern NSString *const WDGVersionString;

@protocol WDGShape <NSObject>
- (double)area;
@end

NS_SWIFT_UI_ACTOR
@interface WDGWidget : NSObject <WDGShape>

- (instancetype)init;
- (instancetype)initWithStyle:(WDGStyle)style;
+ (instancetype)widgetNamed:(NSString *)name NS_SWIFT_NAME(named(_:));

@property (class, readonly, strong) WDGWidget *sharedWidget NS_SWIFT_NAME(shared);
@property (nonatomic, copy) NSString *name;
@property (nonatomic, copy, nullable) NSString *label;
@property (nonatomic, readonly, getter=isEnabled) BOOL enabled;
@property (nonatomic) WDGEdges edges;
@property (nonatomic, readonly) uint64_t size;

- (double)area;
- (void)touch:(id<WDGShape>)shape other:(nullable WDGWidget *)other;
- (NSArray<NSString *> *)tags;
- (nullable NSData *)dataForKey:(NSString *)key;
- (NSDictionary<NSString *, id> *)attributes;
- (void)setObject:(id)value forKey:(NSString *)key;
- (nullable NSDate *)modified;
- (BOOL)saveToPath:(NSString *)path error:(NSError **)error;
- (void)fetchWithCompletion:(void (^)(BOOL ok))completion;
- (void)impact;
- (void)impactWithIntensity:(CGFloat)intensity NS_SWIFT_NAME(impact(intensity:));
- (void)resizeToWidth:(double)width NS_SWIFT_NAME(resize(width:));
- (void)resizeToHeight:(double)height NS_SWIFT_NAME(resize(height:));
- (void)modern API_AVAILABLE(ios(16.0));

@end

double WDGDistance(WDGWidget *a, WDGWidget *b);

NS_ASSUME_NONNULL_END
