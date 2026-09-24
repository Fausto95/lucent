package dev.lucent.bench.turbo;

import androidx.annotation.Nullable;
import com.facebook.react.BaseReactPackage;
import com.facebook.react.bridge.NativeModule;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.module.model.ReactModuleInfo;
import com.facebook.react.module.model.ReactModuleInfoProvider;
import java.util.Map;

public class BenchTurboPackage extends BaseReactPackage {
  @Nullable
  @Override
  public NativeModule getModule(String name, ReactApplicationContext context) {
    return name.equals(NativeBenchTurboSpec.NAME) ? new BenchTurboModule(context) : null;
  }

  @Override
  public ReactModuleInfoProvider getReactModuleInfoProvider() {
    String name = NativeBenchTurboSpec.NAME;
    return () -> Map.of(name, new ReactModuleInfo(name, BenchTurboModule.class.getName(), false, false, false, true));
  }
}
