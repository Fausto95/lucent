package com.bareexample

import android.app.Application
import android.util.Log
import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative
import com.facebook.react.defaults.DefaultReactHost.getDefaultReactHost
import dev.lucent.app.callers.Tally
import dev.lucent.app.callers.note

class MainApplication : Application(), ReactApplication {

  override val reactHost: ReactHost by lazy {
    getDefaultReactHost(
      context = applicationContext,
      packageList =
        PackageList(this).packages.apply {
          // Packages that cannot be autolinked yet can be added manually here, for example:
          // add(MyReactNativePackage())
        },
    )
  }

  /**
   * An instance of a Lucent class the app's own Kotlin made (src/sdk/callers.lucent.ts): it
   * holds the module's state, which the Platform screen's JavaScript reads.
   */
  private var tally: Tally? = null

  override fun onCreate() {
    super.onCreate()
    loadReactNative(this)
    // Kotlin calling a Lucent module, through the API Lucent generates in its Android library.
    runCatching {
      tally = Tally("kotlin").also { it.add(2.0) }
      note("kotlin at launch")
    }.onFailure { Log.e("Lucent", "calling src/sdk/callers.lucent.ts", it) }
  }
}
