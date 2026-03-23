require "json"

package = JSON.parse(File.read(File.join(__dir__, "package.json")))

Pod::Spec.new do |s|
  s.name         = "NitroFetchWebsocketsPrewarmer"
  s.version      = package["version"]
  s.summary      = "Pure ObjC prewarm API for NitroFetchWebsockets"
  s.homepage     = package["homepage"]
  s.license      = package["license"]
  s.authors      = package["author"]

  s.platforms    = { :ios => min_ios_version_supported, :visionos => 1.0 }
  s.source       = { :git => "https://github.com/mrousavy/nitro.git", :tag => "#{s.version}" }

  s.source_files = [
    "prewarm/**/*.{h,m,mm}",
  ]

  s.public_header_files = [
    "prewarm/NitroWebSocketPrewarmer.h",
  ]

  s.pod_target_xcconfig = {
    'HEADER_SEARCH_PATHS' => '"${PODS_TARGET_SRCROOT}/cpp"',
    'DEFINES_MODULE' => 'YES',
    'OTHER_LDFLAGS' => '-lc++',
  }

  s.dependency 'NitroFetchWebsockets'
end
