package com.margelo.nitro.nitrofetch

import com.margelo.nitro.core.ArrayBuffer
import org.chromium.net.UrlRequest as CronetUrlRequest
import java.nio.ByteBuffer

/**
 * Keeps Cronet reading on its executor while bounding buffers whose JS callbacks
 * have not run yet. Each read owns its ArrayBuffer so queued callbacks cannot
 * observe a buffer that Cronet has already reused. Once the 16-buffer window is
 * full, native progress intentionally waits for JS demand to release a slot.
 */
class CronetReadController(
  private val executor: CronetSerialExecutor,
  private val onOperationFailed: (error: Throwable) -> Unit
) {
  private lateinit var cronetRequest: CronetUrlRequest
  private var attached = false
  @Volatile private var finished = false
  private var readInProgress = false
  private var activeBuffer: ArrayBuffer? = null
  private var inFlightReads = 0

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
      requestReadOnExecutor()
    }
  }

  fun completeRead(receivedBuffer: ByteBuffer): ArrayBuffer? {
    executor.checkIsRunning()
    check(readInProgress) { "Cronet completed a read that was not in progress" }
    val arrayBuffer = checkNotNull(activeBuffer) {
      "Cronet completed a read without an active buffer"
    }
    activeBuffer = null
    readInProgress = false

    if (finished) return null

    val bytesRead = receivedBuffer.position()
    check(bytesRead >= 0 && bytesRead <= READ_BUFFER_SIZE) {
      "Cronet returned an invalid read size: $bytesRead"
    }
    inFlightReads++
    check(inFlightReads <= MAX_IN_FLIGHT_READS) {
      "Cronet exceeded the in-flight read window"
    }
    return arrayBuffer
  }

  fun acknowledgeRead() {
    executor.execute {
      check(inFlightReads > 0) { "Cronet received an unexpected read acknowledgement" }
      inFlightReads--
      requestReadOnExecutor()
    }
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

  fun getReadBufferWindowSize(): Double = MAX_IN_FLIGHT_READS.toDouble()

  private fun requestReadOnExecutor() {
    executor.checkIsRunning()
    checkAttached()
    if (finished || readInProgress) return
    if (inFlightReads >= MAX_IN_FLIGHT_READS) return

    val arrayBuffer = ArrayBuffer.allocate(READ_BUFFER_SIZE)
    val byteBuffer = arrayBuffer.getBuffer(false)
    activeBuffer = arrayBuffer
    readInProgress = true

    try {
      cronetRequest.read(byteBuffer)
    } catch (error: Throwable) {
      activeBuffer = null
      readInProgress = false
      failOperation(error)
    }
  }

  private fun failOperation(
    error: Throwable,
    shouldCancelRequest: Boolean = true
  ) {
    executor.checkIsRunning()
    if (finished) return
    finished = true
    activeBuffer = null
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
    private const val MAX_IN_FLIGHT_READS = 16
  }
}
