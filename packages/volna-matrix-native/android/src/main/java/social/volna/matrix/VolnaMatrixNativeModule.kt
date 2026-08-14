package social.volna.matrix

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class VolnaMatrixNativeModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("VolnaMatrixNative")

    Function("getRuntimeInfo") {
      mapOf(
        "available" to true,
        "implementation" to "matrix-rust-sdk-ffi",
        "bindingVersion" to "26.08.13",
        "platform" to "android",
      )
    }
  }
}
