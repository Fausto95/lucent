Pod::Spec.new do |s|
  s.name         = "BenchTurbo"
  s.version      = "0.0.0"
  s.summary      = "NitroBenchmarks' TurboModule, for comparing with Lucent"
  s.homepage     = "https://github.com/Fausto95/lucent"
  s.license      = "MIT"
  s.authors      = "Lucent"
  s.platforms    = { :ios => min_ios_version_supported }
  s.source       = { :git => "https://github.com/Fausto95/lucent.git", :tag => s.version.to_s }

  s.source_files = "ios/**/*.{h,mm}"

  install_modules_dependencies(s)
end
