import { requireNativeModule } from 'expo-modules-core';

export type MatrixNativeRuntimeInfo = {
  available: true;
  implementation: 'matrix-rust-sdk-ffi';
  bindingVersion: string;
  platform: 'android' | 'ios';
};

type VolnaMatrixNativeModule = {
  getRuntimeInfo(): MatrixNativeRuntimeInfo;
};

export default requireNativeModule<VolnaMatrixNativeModule>('VolnaMatrixNative');
