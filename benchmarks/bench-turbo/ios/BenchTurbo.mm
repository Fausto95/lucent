#import "BenchTurbo.h"

@implementation BenchTurbo

RCT_EXPORT_MODULE()

- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:(const facebook::react::ObjCTurboModule::InitParams &)params
{
  return std::make_shared<facebook::react::NativeBenchTurboSpecJSI>(params);
}

- (NSNumber *)addNumbers:(double)a b:(double)b
{
  return [[NSNumber alloc] initWithDouble:a + b];
}

- (NSString *)addStrings:(NSString *)a b:(NSString *)b
{
  NSMutableString *result = [[NSMutableString alloc] initWithString:a];
  [result appendString:b];
  return result;
}

@end
