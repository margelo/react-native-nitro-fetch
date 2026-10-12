package com.margelo.nitro.nitrofetch

import com.margelo.nitro.core.ArrayBuffer
import java.nio.ByteBuffer
import java.nio.ByteOrder

internal class NitroTextStreamBuffer(capacity: Int) {
  val arrayBuffer: ArrayBuffer = ArrayBuffer.allocate(HEADER_SIZE + capacity)
  private val header: ByteBuffer = arrayBuffer.getBuffer(false).order(ByteOrder.LITTLE_ENDIAN)
  val data: ByteBuffer = header.duplicate().apply { position(HEADER_SIZE) }

  init {
    header.putInt(0, 0x31425354)
    header.putShort(4, 1)
    header.putShort(6, HEADER_SIZE.toShort())
    header.putLong(16, capacity.toLong())
  }

  fun commit() {
    header.putLong(8, (data.position() - HEADER_SIZE).toLong())
  }

  fun setStatus(status: Int) {
    if (header.getInt(24) == STATUS_OPEN) header.putInt(24, status)
  }

  companion object {
    const val HEADER_SIZE = 64
    const val MAX_CAPACITY = Int.MAX_VALUE - HEADER_SIZE
    const val STATUS_OPEN = 0
    const val STATUS_DONE = 1
    const val STATUS_ERROR = 2
    const val STATUS_CANCELLED = 3
    const val STATUS_OVERFLOW = 4
  }
}
