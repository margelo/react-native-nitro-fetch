require "json"

package = JSON.parse(File.read(File.join(__dir__, "package.json")))

Pod::Spec.new do |s|
  s.name         = "NitroTextDecoder"
  s.version      = package["version"]
  s.summary      = package["description"]
  s.homepage     = package["homepage"]
  s.license      = package["license"]
  s.authors      = package["author"]

  s.platforms    = { :ios => min_ios_version_supported, :visionos => 1.0 }
  s.source       = { :git => "https://github.com/mrousavy/nitro.git", :tag => "#{s.version}" }

  s.source_files = [
    # Implementation (Swift)
    "ios/**/*.{swift}",
    # Autolinking/Registration (Objective-C++)
    "ios/**/*.{m,mm}",
    # Implementation (C++ objects)
    "cpp/**/*.{hpp,cpp}",
  ]

  s.compiler_flags = '-DSIMDUTF_FEATURE_BASE64=0'

  # simdutf is tuned for -O3; ThinLTO lets the JSI binding inline into
  # the simdutf entry points. CocoaPods inherits Xcode's -Os Release
  # default otherwise, which leaves perf on the table.
  s.pod_target_xcconfig = {
    'GCC_OPTIMIZATION_LEVEL' => '3',
    'LLVM_LTO' => 'YES_THIN',
  }

  load 'nitrogen/generated/ios/NitroTextDecoder+autolinking.rb'
  add_nitrogen_files(s)

  s.dependency 'React-jsi'
  s.dependency 'React-callinvoker'
  install_modules_dependencies(s)
end
