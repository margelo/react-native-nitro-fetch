package com.margelo.nitro.nitrofetch

import java.io.ByteArrayOutputStream
import java.util.concurrent.locks.ReentrantLock
import kotlin.concurrent.withLock
import java.util.concurrent.atomic.AtomicBoolean

internal class ResponseSink {
  private val lock = ReentrantLock()
  private val bodyBuffer = ByteArrayOutputStream()

  @Volatile
  private var isFinalized = false

  private val bodyUsedAtomic = AtomicBoolean(false)
  val bodyUsed: Boolean
    get() = bodyUsedAtomic.get()

  fun appendBufferBody(data: ByteArray) {
    lock.withLock {
      check(!isFinalized) { "Cannot append to finalized sink" }
      bodyBuffer.write(data)
    }
  }

  fun drainAndFinalize(): ByteArray? {
    lock.withLock {
      if (isFinalized) {
        return null
      }

      val result = if (bodyBuffer.size() > 0) {
        bodyBuffer.toByteArray()
      } else {
        null
      }

      bodyBuffer.reset()
      isFinalized = true
      return result
    }
  }

  fun markAsUsed() {
    bodyUsedAtomic.set(true)
  }

  fun clear() {
    lock.withLock {
      bodyBuffer.reset()
      isFinalized = true
    }
  }

  fun getQueuedSize(): Int {
    lock.withLock {
      return bodyBuffer.size()
    }
  }

}
