Pod::Spec.new do |s|
  s.name           = 'VolnaMatrixNative'
  s.version        = '0.1.0'
  s.summary        = 'VOLNA bridge contour for the official Matrix Rust SDK FFI.'
  s.description    = 'Links the integrity-pinned official MatrixSDKFFI XCFramework into an Expo development or production build.'
  s.license        = { :type => 'Apache-2.0' }
  s.author         = { 'VOLNA' => 'security@volna.social' }
  s.homepage       = 'https://github.com/rootkovskiy/volna-client'
  s.platforms      = { :ios => '16.0' }
  s.swift_version  = '5.9'
  s.source         = { :path => '.' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files   = '**/*.{h,m,mm,swift}'
  s.vendored_frameworks = '../vendor/MatrixSDKFFI.xcframework'
end
