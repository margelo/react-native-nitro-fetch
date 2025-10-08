package com.margelo.nitro.nitrofetch

import java.nio.ByteBuffer

/**
 * A buffer that accumulates response body data before streaming starts.
 * This allows the native side to receive and queue data while JS is still
 * setting up the stream, preventing backpressure issues.
 */
internal class ResponseSink {
  private val bodyQueue: MutableList<ByteArray> = mutableListOf()
  private var isFinalized = false

  var bodyUsed = false
    private set

  /**
   * Append data to the queue. Called when streaming hasn't started yet.
   */
  @Synchronized
  fun appendBufferBody(data: ByteArray) {
    if (isFinalized) {
      throw IllegalStateException("Cannot append to finalized sink")
    }
    bodyUsed = true
    bodyQueue.add(data)
  }

  /**
   * Finalize and return all queued data as a single array.
   * This is called when JS starts streaming - we flush everything we've accumulated.
   */
  @Synchronized
  fun finalize(): ByteArray? {
    if (bodyQueue.isEmpty()) {
      isFinalized = true
      return null
    }

    val totalSize = bodyQueue.sumOf { it.size }
    val result = ByteBuffer.allocate(totalSize)

    for (chunk in bodyQueue) {
      result.put(chunk)
    }

    bodyQueue.clear()
    bodyUsed = true
    isFinalized = true

    return result.array()
  }

  /**
   * Get current queue size (for debugging/monitoring)
   */
  @Synchronized
  fun getQueuedSize(): Int = bodyQueue.sumOf { it.size }

  /**
   * Check if sink has been finalized
   */
  @Synchronized
  fun isFinalized(): Boolean = isFinalized
}
