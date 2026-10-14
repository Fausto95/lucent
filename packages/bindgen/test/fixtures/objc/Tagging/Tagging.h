#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

// A category on another module's class, as UIKit's NSObject (UIAccessibility):
// every object has its members.
@interface NSObject (TAGTagging)
@property(nonatomic, copy, nullable) NSString *tagLabel;
@property(nonatomic) BOOL isTagged;
- (BOOL)tagActivate;
- (nullable NSString *)tagValueForKey:(NSString *)key;
@end

@interface TAGItem : NSObject
@end

NS_ASSUME_NONNULL_END
