Pod::Spec.new do |s|
  s.name           = 'VolnaMatrixNative'
  s.version        = '0.1.0'
  s.summary        = 'VOLNA bridge for the custom recipient-enforcing Matrix Rust SDK FFI.'
  s.description    = 'Links a locally built pinned-source MatrixSDKFFI XCFramework; production acceptance remains separate.'
  s.license        = { :type => 'Apache-2.0' }
  s.author         = { 'VOLNA' => 'security@volna.social' }
  s.homepage       = 'https://github.com/rootkovskiy/volna-client'
  s.platforms      = { :ios => '16.0' }
  s.swift_version  = '5.9'
  s.source         = { :path => '.' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  # The XCFramework contains the Rust binary and C ABI only. The official
  # generated Swift UniFFI layer is a separate, equally pinned build input.
  s.source_files   = '**/*.{h,m,mm,swift}', '../vendor/MatrixRustSDK/**/*.swift'
  s.vendored_frameworks = '../vendor/MatrixSDKFFI.xcframework'
end
