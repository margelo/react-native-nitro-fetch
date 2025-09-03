import Foundation

final class NitroEnv: HybridNitroEnvSpec {
    public func getCacheDir() -> String {
        let urls = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)
        return urls.first?.path ?? NSTemporaryDirectory()
    }

    public func createCronetEngine(cacheDir: String?) -> Bool {
        // iOS Cronet wiring TBD; return false for now to let JS/native fallback.
        return false
    }
}
