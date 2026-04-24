require "json"

package = JSON.parse(File.read(File.join(__dir__, "package.json")))

Pod::Spec.new do |s|
  s.name         = "NitroFetch"
  s.version      = package["version"]
  s.summary      = package["description"]
  s.homepage     = package["homepage"]
  s.license      = package["license"]
  s.authors      = package["author"]

  s.platforms    = { :ios => min_ios_version_supported }
  s.source       = { :git => "http://google.com.git", :tag => "#{s.version}" }


  s.source_files = [
    "ios/**/*.{swift}",
    "ios/**/*.{m,mm}",
    "cpp/**/*.{hpp,cpp}",
  ]

  s.dependency 'React-jsi'
  s.dependency 'React-callinvoker'
  s.dependency 'React-RCTNetwork'

  # Expose the DevTools reporter Obj-C facade to Swift via the pod's umbrella module.
  s.public_header_files = ["ios/NitroDevToolsReporter.h"]

  load 'nitrogen/generated/ios/NitroFetch+autolinking.rb'
  add_nitrogen_files(s)

  if ENV['NITROFETCH_TRACING'] == '1'
    current_xcconfig = s.attributes_hash['pod_target_xcconfig'] || {}
    existing = current_xcconfig['SWIFT_ACTIVE_COMPILATION_CONDITIONS'] || '$(inherited)'
    s.pod_target_xcconfig = current_xcconfig.merge({
      'SWIFT_ACTIVE_COMPILATION_CONDITIONS' => "#{existing} NITROFETCH_TRACING"
    })
  end

  install_modules_dependencies(s)
end
