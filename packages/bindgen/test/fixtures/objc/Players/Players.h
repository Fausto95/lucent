#import <Foundation/Foundation.h>
#import <Measures/Measures.h>

NS_ASSUME_NONNULL_BEGIN

@interface PLYPlayer : NSObject
@property (nonatomic) MSRTime currentTime;
@property (nonatomic) MSRSpan loop;
@property (nonatomic, readonly) MSRTrackID track;
@property (nonatomic) MSRRange selection;
@end

NS_ASSUME_NONNULL_END
