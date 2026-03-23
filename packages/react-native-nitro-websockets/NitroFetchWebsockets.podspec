require "json"

package = JSON.parse(File.read(File.join(__dir__, "package.json")))

Pod::Spec.new do |s|
  s.name         = "NitroFetchWebsockets"
  s.version      = package["version"]
  s.summary      = package["description"]
  s.homepage     = package["homepage"]
  s.license      = package["license"]
  s.authors      = package["author"]

  s.platforms    = { :ios => min_ios_version_supported, :visionos => 1.0 }
  s.source       = { :git => "https://github.com/mrousavy/nitro.git", :tag => "#{s.version}" }

  s.source_files = [
    "ios/**/*.{swift,h,m,mm,hpp}",
    "cpp/*.{hpp,cpp}",
  ]

  load 'nitrogen/generated/ios/NitroFetchWebsockets+autolinking.rb'
  add_nitrogen_files(s)

  s.public_header_files = [
    "nitrogen/generated/ios/NitroFetchWebsockets-Swift-Cxx-Bridge.hpp",
    "ios/NitroWebSocketPrewarmer.h",
  ]
  s.private_header_files = [
    "cpp/*.hpp",
    "ios/NWWebSocketConnection.hpp",
    "nitrogen/generated/shared/**/*.{h,hpp}",
    "nitrogen/generated/ios/c++/**/*.{h,hpp}",
  ]

  current_xcconfig = s.attributes_hash['pod_target_xcconfig'] || {}
  s.pod_target_xcconfig = current_xcconfig.merge({
    'HEADER_SEARCH_PATHS' => [
      '"${PODS_TARGET_SRCROOT}/cpp"',
      '"${PODS_TARGET_SRCROOT}/ios"',
    ].join(' '),
    'OTHER_LDFLAGS' => '-lc++',
  })

  s.dependency 'React-jsi'
  s.dependency 'React-callinvoker'
  install_modules_dependencies(s)
end
