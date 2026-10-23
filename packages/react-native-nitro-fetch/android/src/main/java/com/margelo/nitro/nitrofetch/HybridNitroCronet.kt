package com.margelo.nitro.nitrofetch

import com.facebook.proguard.annotations.DoNotStrip

/**
 * Streaming-focused Nitro Cronet client.
 * Builds stream requests on the default client's engine and executor, so both transports
 * share one HTTP cache and one connection pool.
 */
@DoNotStrip
class HybridNitroCronet : HybridNitroCronetSpec() {

  override fun newUrlRequestBuilder(url: String): HybridUrlRequestBuilderSpec {
    return HybridUrlRequestBuilder(
      engine = HybridNitroFetch.getEngine(),
      url = url,
      executor = HybridNitroFetch.ioExecutor
    )
  }
}
