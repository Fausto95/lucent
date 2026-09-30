#import <Foundation/Foundation.h>
#import <GaugeKit/GKDial.h>

@interface GKGauge : NSObject
- (instancetype)initWithDial:(GKDial *)dial;
@property (nonatomic, readonly) GKDial *dial;
@property (nonatomic) double value;
@end
