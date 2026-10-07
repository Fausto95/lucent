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

typedef struct {
  double x;
  double y;
} WDGPoint;

typedef struct {
  WDGPoint center;
  double radius;
} WDGCircle;

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
/// A factory Swift imports as an initializer: init(label:).
+ (instancetype)widgetWithLabel:(NSString *)label;

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
- (BOOL)canFrob:(NSInteger)level error:(NSError **)error NS_SWIFT_NOTHROW;
- (void)fetchWithCompletion:(void (^)(BOOL ok))completion;
- (void)impact;
- (void)impactWithIntensity:(CGFloat)intensity NS_SWIFT_NAME(impact(intensity:));
- (void)resizeToWidth:(double)width NS_SWIFT_NAME(resize(width:));
// A method named as a property once labels are dropped (UIView's frame(forAlignmentRect:)).
- (double)labelForWidth:(double)width NS_SWIFT_NAME(label(forWidth:));
- (void)resizeToHeight:(double)height NS_SWIFT_NAME(resize(height:));
- (void)modern API_AVAILABLE(ios(16.0));
- (void)animate:(void (^)(void))changes completion:(void (^_Nullable)(BOOL finished))completion;
- (NSInteger)countWhere:(BOOL (NS_NOESCAPE ^)(NSString *item))predicate;
- (void)frame:(CGRect)rect;
- (WDGPoint)origin;
@property (nonatomic) WDGCircle circle;

@end

@class WDGLoader;

/// A delegate protocol: requirements Lucent classes implement.
@protocol WDGLoaderDelegate <NSObject>
- (void)loader:(WDGLoader *)loader didLoadData:(NSData *)data;
@optional
- (void)loader:(WDGLoader *)loader didFailWithError:(NSError *)error;
- (BOOL)loaderShouldRetry:(WDGLoader *)loader;
@end

/// Not main-actor: its callbacks can come from any thread.
@interface WDGLoader : NSObject
@property (nonatomic, weak, nullable) id<WDGLoaderDelegate> delegate;
- (void)observeWithBlock:(void (^)(NSString *name, NSInteger count))block;
- (void)loadWithReply:(void (^)(NSData *_Nullable data, NSError *_Nullable error))reply;
- (void)onDone:(void (^)(void))done NS_SWIFT_DISABLE_ASYNC;
- (void)getItemsWithCompletionHandler:(void (^)(NSArray<NSString *> *items))completionHandler;
@end

/// A lightweight generic, as NSCache is: its type parameter's values are objects.
@interface WDGBox<__covariant ObjectType> : NSObject
@property (nonatomic, readonly) ObjectType first;
- (nullable ObjectType)object;
- (void)setObject:(ObjectType)object;
@end

@interface WDGBoxes : NSObject
+ (WDGBox<NSString *> *)names;
+ (void)fill:(WDGBox<WDGWidget *> *)box;
@end

/// Conforms to NSSecureCoding without declaring initWithCoder: (Swift synthesizes it), as NSDateComponents does.
@interface WDGRecord : NSObject <NSSecureCoding>
@property (nonatomic) NSInteger count;
@end

/// A subclass adopting one more protocol: its schema lists that one, not its superclass's.
@interface WDGGauge : WDGWidget <WDGLoaderDelegate>
@end

/// A subclass redeclaring a property null_resettable: reading it never gives nil.
@interface WDGLabelBase : NSObject
@property (nonatomic, readonly, copy) NSString *text;
@end

@interface WDGLabel : WDGLabelBase
@property (nonatomic, copy, null_resettable) NSString *text;
@end

/// Swift names it text(for:), whose base name is the superclass's property.
@interface WDGCaption : WDGLabelBase
- (NSString *)textForState:(NSInteger)state NS_SWIFT_NAME(text(for:));
@end

/// A protocol a class adopts while declaring its requirement differently.
@protocol WDGFramed <NSObject>
- (double)level;
@end

@interface WDGPanel : NSObject <WDGFramed>
@property (nonatomic) double level;
@end

/// Adopts two protocols: which comes first is the extractor's to decide, not the tool's.
@interface WDGDial : NSObject <WDGShape, WDGFramed>
@end

/// A struct with no fields: never declared, so its name is not offered either.
typedef struct {
} WDGEmpty;

/// Pointers a method writes into, and reads first when they are inout.
@interface WDGMeter : NSObject
- (BOOL)getLevel:(CGFloat *)level peak:(nullable CGFloat *)peak;
- (void)getStyle:(WDGStyle *)style;
- (void)adjustPoint:(WDGPoint *)point;
- (BOOL)readSince:(NSDate *_Nullable *_Nullable)since label:(NSString *_Nullable *_Nullable)label;
- (void)getOn:(BOOL *)on;
- (void)enumerateLevels:(void (NS_NOESCAPE ^)(double level, BOOL *stop))block;
@end

/// A class whose only initializer of its own is a factory: it keeps NSObject's init.
@interface WDGBadge : NSObject
+ (instancetype)badgeWithText:(NSString *)text;
@end

/// NSFileHandle's shape: factories Swift imports as initializers taking the
/// same types (init?(forReadingAtPath:), init?(forUpdatingAtPath:)); NSURL's:
/// initializers taking the same types (init(fileURLWithPath:), init?(string:));
/// and MMKV's: overloads Swift names alike, set(_:forKey:).
@interface WDGHandle : NSObject
+ (nullable instancetype)handleForReadingAtPath:(NSString *)path;
+ (nullable instancetype)handleForUpdatingAtPath:(NSString *)path;
- (instancetype)initFileURLWithPath:(NSString *)path;
- (nullable instancetype)initWithString:(NSString *)string;
- (BOOL)setInt32:(int32_t)value forKey:(NSString *)key NS_SWIFT_NAME(set(_:forKey:));
- (BOOL)setDouble:(double)value forKey:(NSString *)key NS_SWIFT_NAME(set(_:forKey:));
- (BOOL)setFloat:(float)value forKey:(NSString *)key NS_SWIFT_NAME(set(_:forKey:));
@end

double WDGDistance(WDGWidget *a, WDGWidget *b);

typedef enum {
  wdg_state_idle = 0,
  wdg_state_busy = 3,
  wdg_state_done,
} wdg_state_t;
typedef void (^wdg_handler_t)(wdg_state_t state);
void WDGWatch(wdg_handler_t handler);

CF_IMPLICIT_BRIDGING_ENABLED
extern const CFStringRef WDGKeyClass;
OSStatus WDGItemCopy(CFDictionaryRef query, CFTypeRef _Nullable * _Nullable result);
CFDataRef _Nullable WDGCopyData(CFStringRef name) CF_RETURNS_RETAINED;
CF_IMPLICIT_BRIDGING_DISABLED

NS_ASSUME_NONNULL_END
