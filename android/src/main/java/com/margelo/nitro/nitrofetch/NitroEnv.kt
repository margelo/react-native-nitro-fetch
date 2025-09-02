package com.margelo.nitro.nitrofetch

import com.facebook.proguard.annotations.DoNotStrip

@DoNotStrip
class NitroEnv : HybridNitroEnvSpec() {
  // TODO: Wire ReactApplicationContext if available via generated base.
  // For now, this is a placeholder; implement using context.cacheDir.absolutePath.
  override fun getCacheDir(): String {
    throw NotImplementedError("NitroEnv.getCacheDir not implemented on Android yet")
  }
}

