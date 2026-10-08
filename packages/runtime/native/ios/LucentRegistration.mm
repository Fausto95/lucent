// Registers the Lucent C++ TurboModule when the binary loads, so React Native
// finds it without codegen or any change to the app delegate.
#import <Foundation/Foundation.h>

#include <ReactCommon/CxxTurboModuleUtils.h>

#include "LucentModule.h"

@interface LucentRegistration : NSObject
@end

@implementation LucentRegistration

+ (void)load
{
  std::string name(facebook::react::LucentModule::kModuleName);

  // One Lucent per app: a second copy (two LucentNative pods, or a
  // prebuilt framework linking its own) would silently replace this one,
  // its modules answering for code compiled against this one's.
  if (facebook::react::globalExportedCxxTurboModuleMap().count(name)) {
    NSString* reason = [NSString stringWithFormat:@"Lucent: a TurboModule named \"%s\" is already registered. The app links two copies of "
                                                   "LucentNative (two pods, or a framework with its own); link one.",
                                                  name.c_str()];
    NSLog(@"%@", reason);
    @throw [NSException exceptionWithName:NSInternalInconsistencyException reason:reason userInfo:nil];
  }

  facebook::react::registerCxxModuleToGlobalModuleMap(name, [](std::shared_ptr<facebook::react::CallInvoker> jsInvoker) {
    return std::make_shared<facebook::react::LucentModule>(std::move(jsInvoker));
  });
}

@end
