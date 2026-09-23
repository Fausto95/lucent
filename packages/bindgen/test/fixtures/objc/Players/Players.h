#import <Foundation/Foundation.h>
#import <Measures/Measures.h>

NS_ASSUME_NONNULL_BEGIN

@interface PLYPlayer : NSObject
@property (nonatomic) MSRTime currentTime;
@property (nonatomic) MSRSpan loop;
@property (nonatomic, readonly) MSRTrackID track;
@property (nonatomic) MSRRange selection;
@property (nonatomic, copy) NSIndexPath *position;
- (void)openRequest:(NSURLRequest *)request;
@property (nonatomic, nullable) MSRBufferRef buffer;
- (nullable MSRBufferRef)copyBuffer CF_RETURNS_RETAINED;
@property (nonatomic, copy) NSSet<NSString *> *tags;
- (void)followPlayers:(NSSet<PLYPlayer *> *)players;
@end

NS_ASSUME_NONNULL_END
