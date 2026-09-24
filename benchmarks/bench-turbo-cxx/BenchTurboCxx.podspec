Pod::Spec.new do |s|
  s.name         = "BenchTurboCxx"
  s.version      = "0.0.0"
  s.summary      = "NitroBenchmarks' C++ TurboModule, for comparing with Lucent"
  s.homepage     = "https://github.com/Fausto95/lucent"
  s.license      = "MIT"
  s.authors      = "Lucent"
  s.platforms    = { :ios => min_ios_version_supported }
  s.source       = { :git => "https://github.com/Fausto95/lucent.git", :tag => s.version.to_s }

  s.source_files = ["cpp/**/*.{h,cpp}", "ios/**/*.mm"]
  s.pod_target_xcconfig = { "CLANG_CXX_LANGUAGE_STANDARD" => "c++20" }

  install_modules_dependencies(s)
end
