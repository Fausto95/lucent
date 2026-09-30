#import <Foundation/Foundation.h>

// Shapes whose binding plans decide how they cross, or why they cannot.

NS_ASSUME_NONNULL_BEGIN

/// An option set without a case for "no options".
typedef NS_OPTIONS(NSUInteger, ABIEdges) {
  ABIEdgesTop = 1 << 0,
  ABIEdgesBottom = 1 << 1,
};

typedef struct {
  double x;
  double y;
} ABIPoint;

@class ABIThing;

/// A requirement that receives a pointer, and runs later: it cannot write it back.
@protocol ABIMeterDelegate <NSObject>
- (void)meter:(ABIThing *)meter didMeasure:(ABIPoint *)point;
@end

@interface ABIThing : NSObject

- (instancetype)init;

// Collections of collections: passed in, not read back yet.
- (NSArray<NSArray<NSString *> *> *)grid;
- (void)fill:(NSArray<NSArray<NSString *> *> *)grid;

// An error passed in.
- (void)report:(NSError *)error;

// A block stored in a property.
@property (nonatomic, copy, nullable) void (^onChange)(NSInteger count);

@property (nonatomic, weak, nullable) id<ABIMeterDelegate> delegate;

// 64-bit integers: bigints, exactly or a RangeError.
@property (nonatomic) int64_t identifier;
- (void)readCount:(NSInteger *)count;

@property (nonatomic) ABIEdges edges;
- (void)insetEdges:(ABIEdges)edges;
- (NSUInteger)countOfItems;
- (ABIPoint)pointAt:(NSInteger)index;

// Shapes with no Lucent value: each skipped with a precise reason.
- (void)perform:(SEL)action;
- (void)registerClass:(Class)cls;
- (void)writeBytes:(const void *)bytes length:(NSUInteger)length;
- (void)writeBuffer:(const uint8_t *)buffer count:(NSUInteger)count;
- (void)useZone:(nullable NSZone *)zone;
- (void)keep:(id<NSCopying, NSSecureCoding>)value;
- (void)place:(NSObject<NSCopying> *)value;

@end

NS_ASSUME_NONNULL_END
