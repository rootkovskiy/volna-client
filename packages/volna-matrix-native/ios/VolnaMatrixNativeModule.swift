import ExpoModulesCore
import MatrixSDKFFI

public final class VolnaMatrixNativeModule: Module {
  public func definition() -> ModuleDefinition {
    Name("VolnaMatrixNative")

    Function("getRuntimeInfo") {
      return [
        "available": true,
        "implementation": "matrix-rust-sdk-ffi",
        "bindingVersion": "26.08.11",
        "platform": "ios",
      ]
    }
  }
}
