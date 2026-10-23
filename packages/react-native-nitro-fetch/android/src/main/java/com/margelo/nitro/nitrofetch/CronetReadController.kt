package com.margelo.nitro.nitrofetch

import com.margelo.nitro.core.ArrayBuffer
import org.chromium.net.UrlRequest as CronetUrlRequest
import java.nio.ByteBuffer

/**
 * Routes every UrlRequest operation through the executor Cronet uses for that
 * request. The existing JS-driven read cadence still controls body progress.
 */
class CronetReadController(
  private val executor: CronetSerialExecutor,
  private val onOperationFailed: (error: Throwable) -> Unit
) {
  private lateinit var cronetRequest: CronetUrlRequest
  private val reusableBuffer = ArrayBuffer.allocate(READ_BUFFER_SIZE)
  private val byteBuffer = reusableBuffer.getBuffer(false)
  private var attached = false
  @Volatile private var finished = false
  private var readInProgress = false

  fun attach(request: CronetUrlRequest) {
    check(!attached) { "Cronet read controller is already attached" }
    cronetRequest = request
    attached = true
  }

  fun start() {
    executor.execute {
      checkAttached()
      if (finished) return@execute
      try {
        cronetRequest.start()
      } catch (error: Throwable) {
        failOperation(error)
      }
    }
  }

  fun followRedirect() {
    executor.execute {
      checkAttached()
      if (finished) return@execute
      try {
        cronetRequest.followRedirect()
      } catch (error: Throwable) {
        failOperation(error)
      }
    }
  }

  fun requestRead() {
    executor.execute {
      checkAttached()
      if (finished) return@execute
      check(!readInProgress) { "Cronet read is already in progress" }
      byteBuffer.clear()
      readInProgress = true
      try {
        cronetRequest.read(byteBuffer)
      } catch (error: Throwable) {
        readInProgress = false
        failOperation(error)
      }
    }
  }

  fun completeRead(receivedBuffer: ByteBuffer): ArrayBuffer? {
    executor.checkIsRunning()
    check(readInProgress) { "Cronet completed a read that was not in progress" }
    check(receivedBuffer === byteBuffer) { "Cronet returned an unexpected read buffer" }
    readInProgress = false
    if (finished) return null

    val bytesRead = receivedBuffer.position()
    check(bytesRead >= 0 && bytesRead <= READ_BUFFER_SIZE) {
      "Cronet returned an invalid read size: $bytesRead"
    }
    return reusableBuffer
  }

  fun finish() {
    executor.checkIsRunning()
    finished = true
  }

  fun cancel() {
    executor.execute {
      checkAttached()
      if (finished) return@execute
      try {
        cronetRequest.cancel()
        finished = true
      } catch (error: Throwable) {
        failOperation(error, shouldCancelRequest = false)
      }
    }
  }

  fun isFinished(): Boolean = finished

  private fun failOperation(
    error: Throwable,
    shouldCancelRequest: Boolean = true
  ) {
    executor.checkIsRunning()
    if (finished) return
    finished = true
    readInProgress = false
    if (shouldCancelRequest) {
      // Stop native work before publishing the original operation failure.
      try {
        cronetRequest.cancel()
      } catch (_: Throwable) {
        // Preserve the original operation failure as the terminal error.
      }
    }
    // Executor-dispatched UrlRequest exceptions cannot cross the synchronous
    // HybridObject call, so complete the request through its failure callback.
    onOperationFailed(error)
  }

  private fun checkAttached() {
    check(attached) { "Cronet read controller is not attached" }
  }

  companion object {
    private const val READ_BUFFER_SIZE = 64 * 1024
  }
}
