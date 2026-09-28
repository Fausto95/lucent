#import <Foundation/Foundation.h>

typedef NS_ENUM(NSInteger, GKDialStyle) {
  GKDialStyleArc,
  GKDialStyleRing = 3,
};

@interface GKDial : NSObject
@property (nonatomic) GKDialStyle style;
@end
