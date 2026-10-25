package com.margelo.nitro.nitrofetchwebsockets

import android.content.ContentProvider
import android.content.ContentValues
import android.database.Cursor
import android.net.Uri

/**
 * Hands [NitroWSPinning] the application Context when the process starts, before
 * Application.onCreate, so a prewarm started there checks nitro-fetch-pinning.json like any other
 * wss:// connection. Declared in this library's AndroidManifest.xml.
 */
internal class NitroWSContextProvider : ContentProvider() {
  override fun onCreate(): Boolean {
    NitroWSPinning.application = context?.applicationContext
    return true
  }

  override fun query(uri: Uri, projection: Array<out String>?, selection: String?, selectionArgs: Array<out String>?, sortOrder: String?): Cursor? = null

  override fun getType(uri: Uri): String? = null

  override fun insert(uri: Uri, values: ContentValues?): Uri? = null

  override fun delete(uri: Uri, selection: String?, selectionArgs: Array<out String>?): Int = 0

  override fun update(uri: Uri, values: ContentValues?, selection: String?, selectionArgs: Array<out String>?): Int = 0
}
