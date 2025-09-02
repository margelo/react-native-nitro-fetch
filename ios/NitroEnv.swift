import Foundation

final class NitroEnv: HybridNitroEnvSpec {
    public func getCacheDir() -> String {
        let urls = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)
        return urls.first?.path ?? NSTemporaryDirectory()
    }
}

