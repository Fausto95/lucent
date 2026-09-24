// Registers the C++ TurboModule when the binary loads.
#import <Foundation/Foundation.h>

#include <ReactCommon/CxxTurboModuleUtils.h>

#include "BenchTurboCxx.h"

@interface BenchTurboCxxRegistration : NSObject
@end

@implementation BenchTurboCxxRegistration

+ (void)load
{
  facebook::react::registerCxxModuleToGlobalModuleMap(
      std::string(facebook::react::BenchTurboCxx::kModuleName),
      [](std::shared_ptr<facebook::react::CallInvoker> jsInvoker) {
        return std::make_shared<facebook::react::BenchTurboCxx>(std::move(jsInvoker));
      });
}

@end
