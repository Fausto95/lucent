Pod::Spec.new do |s|
  s.name           = 'BenchExpo'
  s.version        = '0.0.0'
  s.summary        = "NitroBenchmarks' Expo module, for comparing with Lucent"
  s.license        = 'MIT'
  s.author         = 'Lucent'
  s.homepage       = 'https://github.com/Fausto95/lucent'
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { git: 'https://github.com/Fausto95/lucent.git' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.source_files = "**/*.swift"
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
