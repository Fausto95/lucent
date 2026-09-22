package {{androidPackage}}

import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfoProvider{{viewImports}}

class {{ident}}Package : BaseReactPackage() {
{{viewManagers}}  override fun getModule(name: String, reactContext: ReactApplicationContext): NativeModule? = null

  override fun getReactModuleInfoProvider(): ReactModuleInfoProvider = ReactModuleInfoProvider { HashMap() }

  companion object {
    init {
      {{moduleName}}OnLoad.initializeNative()
    }
  }
}
