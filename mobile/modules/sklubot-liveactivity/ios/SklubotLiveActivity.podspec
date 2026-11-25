require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))

# Same layout as the Expo SDK modules' podspecs (for example expo-haptics/ios/ExpoHaptics.podspec).
Pod::Spec.new do |s|
  s.name           = 'SklubotLiveActivity'
  s.version        = package['version']
  s.summary        = package['description']
  s.description    = package['description']
  s.license        = package['license']
  s.author         = 'Sklubot'
  s.homepage       = 'https://sklubot.sklubs.fr'
  s.platforms      = {
    :ios => '16.4'
  }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.frameworks = 'ActivityKit'

  s.source_files = "**/*.{h,m,swift}"
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
