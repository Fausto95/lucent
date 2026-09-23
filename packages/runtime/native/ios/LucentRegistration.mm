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
  facebook::react::registerCxxModuleToGlobalModuleMap(
      std::string(facebook::react::LucentModule::kModuleName),
      [](std::shared_ptr<facebook::react::CallInvoker> jsInvoker) {
        return std::make_shared<facebook::react::LucentModule>(std::move(jsInvoker));
      });
}

@end
