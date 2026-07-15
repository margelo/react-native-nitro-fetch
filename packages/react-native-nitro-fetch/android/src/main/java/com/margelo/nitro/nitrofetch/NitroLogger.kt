package com.margelo.nitro.nitrofetch

import android.util.Log

/** Flip [enabled] to log in release builds too. */
object NitroLogger {
  @JvmField var enabled: Boolean = BuildConfig.DEBUG

  fun d(tag: String, msg: String) { if (enabled) Log.d(tag, msg) }
  fun i(tag: String, msg: String) { if (enabled) Log.i(tag, msg) }
  fun w(tag: String, msg: String, t: Throwable? = null) { if (enabled) Log.w(tag, msg, t) }
  fun e(tag: String, msg: String, t: Throwable? = null) { if (enabled) Log.e(tag, msg, t) }
}
