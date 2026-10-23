package com.margelo.nitro.nitrofetch

import java.util.ArrayDeque
import java.util.concurrent.Executor

/**
 * Preserves callback order for one Cronet request while sharing the global I/O
 * pool. Starting the next read inside a callback can otherwise let another pool
 * thread enqueue a later JS callback first.
 */
class CronetSerialExecutor(
  private val delegate: Executor
) : Executor {
  private val lock = Any()
  private val tasks = ArrayDeque<Runnable>()
  private val executing = ThreadLocal<Boolean>()
  private var running = false

  override fun execute(command: Runnable) {
    val task = Runnable {
      executing.set(true)
      try {
        command.run()
      } finally {
        executing.remove()
        scheduleNext()
      }
    }
    var shouldSchedule = false
    synchronized(lock) {
      tasks.addLast(task)
      if (!running) {
        running = true
        shouldSchedule = true
      }
    }
    if (shouldSchedule) scheduleNext()
  }

  fun checkIsRunning() {
    val isExecuting = executing.get()
    check(isExecuting == true) {
      "Cronet request operation ran outside its executor"
    }
  }

  private fun scheduleNext() {
    val nextTask = synchronized(lock) {
      if (tasks.isEmpty()) {
        running = false
        null
      } else {
        tasks.removeFirst()
      }
    }
    if (nextTask != null) delegate.execute(nextTask)
  }
}
