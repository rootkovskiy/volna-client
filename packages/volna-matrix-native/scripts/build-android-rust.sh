#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Run in Linux/WSL with a source tree produced by prepareSdkSource('android').
set -euo pipefail
source_dir="$(realpath "${1:?patched source directory required}")"
ndk_dir="$(realpath "${2:?Android NDK r27d directory required}")"
output_dir="${3:?output directory required}"
mkdir -p "$output_dir"
output_dir="$(realpath "$output_dir")"
grep -q '27.3.13750724' "$ndk_dir/source.properties"
export RUSTUP_TOOLCHAIN=1.95.0 CARGO_BUILD_JOBS=2
export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-$output_dir/target}"
export ANDROID_NDK_HOME="$ndk_dir"
toolchain="$ndk_dir/toolchains/llvm/prebuilt/linux-x86_64/bin"
cd "$source_dir"
for mapping in 'aarch64-linux-android arm64-v8a aarch64-linux-android' 'x86_64-linux-android x86_64 x86_64-linux-android' 'armv7-linux-androideabi armeabi-v7a armv7a-linux-androideabi' 'i686-linux-android x86 i686-linux-android'; do
  read -r target abi compiler <<< "$mapping"
  rustup target add "$target"
  target_env="${target//-/_}"
  upper_target="${target_env^^}"
  clang="$toolchain/${compiler}24-clang"
  env "CARGO_TARGET_${upper_target}_LINKER=$clang" "CC_${target_env}=$clang" "CC_${target}=$clang" \
    "AR_${target_env}=$toolchain/llvm-ar" cargo rustc --locked --release -p matrix-sdk-ffi --target "$target" -- -C link-arg=-Wl,-z,max-page-size=16384
  mkdir -p "$output_dir/jniLibs/$abi"
  cp "$CARGO_TARGET_DIR/$target/release/libmatrix_sdk_ffi.so" "$output_dir/jniLibs/$abi/"
  "$toolchain/llvm-strip" --strip-unneeded "$output_dir/jniLibs/$abi/libmatrix_sdk_ffi.so"
  "$toolchain/llvm-readelf" -l "$output_dir/jniLibs/$abi/libmatrix_sdk_ffi.so" | \
    awk '$1 == "LOAD" { count++; if ($NF != "0x4000") bad = 1 } END { exit (bad || !count) }'
done
cargo run --locked -p uniffi-bindgen -- generate --library --language kotlin --no-format \
  --out-dir "$output_dir/kotlin" "$CARGO_TARGET_DIR/aarch64-linux-android/release/libmatrix_sdk_ffi.so"
