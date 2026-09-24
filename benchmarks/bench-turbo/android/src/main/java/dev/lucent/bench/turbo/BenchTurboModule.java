package dev.lucent.bench.turbo;

import androidx.annotation.NonNull;
import com.facebook.react.bridge.ReactApplicationContext;

/** NitroBenchmarks' MyTurboModule. */
public class BenchTurboModule extends NativeBenchTurboSpec {
  public BenchTurboModule(ReactApplicationContext context) {
    super(context);
  }

  @Override
  public double addNumbers(double a, double b) {
    return a + b;
  }

  @Override
  @NonNull
  public String addStrings(String a, String b) {
    return a + b;
  }
}
