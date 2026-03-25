package com.margelo.nitro.nitrofetchwebsockets

import android.app.Application
import android.content.Context
import android.content.SharedPreferences
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.spec.GCMParameterSpec

/**
 * Duplicate of [com.margelo.nitro.nitrofetch.NitroFetchSecureAtRest] — keep
 * [KEYSTORE_ALIAS], [ENC_PREFIX], [PREFS_NAME] in sync with nitro-fetch.
 */
private object NitroWSSecureAtRest {
  const val PREFS_NAME = "nitro_fetch_storage"
  private const val KEYSTORE_ALIAS = "nitro_fetch_aes_gcm_v1"
  private const val ANDROID_KEYSTORE = "AndroidKeyStore"
  private const val TRANSFORMATION = "AES/GCM/NoPadding"
  private const val GCM_IV_LENGTH = 12
  private const val GCM_TAG_BITS = 128
  const val ENC_PREFIX = "nfc1:"

  private fun keyStore(): KeyStore =
    KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }

  private fun getOrCreateSecretKey(): javax.crypto.SecretKey {
    val ks = keyStore()
    if (ks.containsAlias(KEYSTORE_ALIAS)) {
      return (ks.getEntry(KEYSTORE_ALIAS, null) as KeyStore.SecretKeyEntry).secretKey
    }
    val keyGenerator =
      KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, ANDROID_KEYSTORE)
    val spec =
      KeyGenParameterSpec.Builder(
        KEYSTORE_ALIAS,
        KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT
      )
        .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
        .setKeySize(256)
        .build()
    keyGenerator.init(spec)
    return keyGenerator.generateKey()
  }

  private fun encrypt(plaintext: String): String {
    val key = getOrCreateSecretKey()
    val cipher = Cipher.getInstance(TRANSFORMATION)
    cipher.init(Cipher.ENCRYPT_MODE, key)
    val iv = cipher.iv
    val ciphertext = cipher.doFinal(plaintext.toByteArray(Charsets.UTF_8))
    val combined = ByteArray(iv.size + ciphertext.size)
    System.arraycopy(iv, 0, combined, 0, iv.size)
    System.arraycopy(ciphertext, 0, combined, iv.size, ciphertext.size)
    return Base64.encodeToString(combined, Base64.NO_WRAP)
  }

  private fun decrypt(b64: String): String {
    val combined = Base64.decode(b64, Base64.NO_WRAP)
    if (combined.size < GCM_IV_LENGTH + 16) {
      throw IllegalArgumentException("truncated")
    }
    val iv = combined.copyOfRange(0, GCM_IV_LENGTH)
    val ciphertext = combined.copyOfRange(GCM_IV_LENGTH, combined.size)
    val key = getOrCreateSecretKey()
    val cipher = Cipher.getInstance(TRANSFORMATION)
    cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(GCM_TAG_BITS, iv))
    return String(cipher.doFinal(ciphertext), Charsets.UTF_8)
  }

  fun getDecryptedForPrefs(prefs: SharedPreferences, key: String): String? {
    val raw = prefs.getString(key, null) ?: return null
    if (raw.isEmpty()) return ""
    return if (raw.startsWith(ENC_PREFIX)) {
      try {
        decrypt(raw.substring(ENC_PREFIX.length))
      } catch (_: Throwable) {
        raw
      }
    } else {
      try {
        putEncrypted(prefs, key, raw)
      } catch (_: Throwable) {}
      raw
    }
  }

  fun putEncrypted(prefs: SharedPreferences, key: String, plain: String): Boolean {
    val enc = ENC_PREFIX + encrypt(plain)
    return prefs.edit().putString(key, enc).commit()
  }
}

/**
 * Reads the WebSocket prewarm queue from SharedPreferences and fires
 * [NitroWebSocketPrewarmer.preWarm] for each entry.
 *
 * If a token refresh config is stored under `nitro_token_refresh_websocket`,
 * it calls the refresh endpoint synchronously (on a background thread) and
 * injects the resulting headers into every prewarm entry before connecting.
 *
 * Call [prewarmOnStart] from `Application.onCreate()` — a single line replaces
 * per-URL manual setup:
 *
 * ```kotlin
 * override fun onCreate() {
 *   super.onCreate()
 *   NitroWebSocketAutoPrewarmer.prewarmOnStart(this)
 * }
 * ```
 *
 * The prewarm queue is written by the JS `prewarmOnAppStart()` helper from
 * `react-native-nitro-websockets`.
 */
object NitroWebSocketAutoPrewarmer {
  @Volatile private var initialized = false
  private const val PREFS_NAME = NitroWSSecureAtRest.PREFS_NAME
  private const val KEY_QUEUE = "nitro_ws_prewarm_queue"
  private const val KEY_TOKEN_REFRESH = "nitro_token_refresh_websocket"
  private const val KEY_TOKEN_CACHE = "nitro_token_refresh_ws_cache"

  @JvmStatic
  fun prewarmOnStart(app: Application) {
    if (initialized) return
    initialized = true
    try {
      val prefs = app.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
      val raw = prefs.getString(KEY_QUEUE, null) ?: return
      val arr = JSONArray(raw)
      android.util.Log.d("NitroWS", "Auto-prewarmer starting — ${arr.length()} URL(s) in queue")

      val refreshRaw = NitroWSSecureAtRest.getDecryptedForPrefs(prefs, KEY_TOKEN_REFRESH)

      if (!refreshRaw.isNullOrEmpty()) {
        // Token refresh requires a network call — run everything on a background thread
        Thread {
          try {
            val refreshConfig = JSONObject(refreshRaw)
            val onFailure = refreshConfig.optString("onFailure", "useStoredHeaders")
            val refreshURL = refreshConfig.optString("url", "(unknown)")
            android.util.Log.d("NitroWS", "[TokenRefresh] Calling refresh endpoint: $refreshURL")

            val refreshed = callTokenRefreshSync(refreshConfig)

            val tokenHeaders: Map<String, String> = if (refreshed != null) {
              android.util.Log.d("NitroWS", "[TokenRefresh] ✅ Success — got ${refreshed.size} header(s)")
              refreshed.forEach { (k, v) -> android.util.Log.d("NitroWS", "[TokenRefresh]   $k: $v") }
              // Cache fresh token headers for useStoredHeaders fallback on next cold start
              val cacheJson = JSONObject()
              refreshed.forEach { (k, v) -> cacheJson.put(k, v) }
              NitroWSSecureAtRest.putEncrypted(prefs, KEY_TOKEN_CACHE, cacheJson.toString())
              refreshed
            } else {
              android.util.Log.d("NitroWS", "[TokenRefresh] ❌ Refresh failed — onFailure: $onFailure")
              if (onFailure == "skip") {
                android.util.Log.d("NitroWS", "[TokenRefresh] Skipping all prewarms")
                return@Thread
              }
              // Use last cached token headers (or empty map if none cached yet)
              val cacheRaw = NitroWSSecureAtRest.getDecryptedForPrefs(prefs, KEY_TOKEN_CACHE)
              val cached = if (cacheRaw != null) {
                try {
                  val co = JSONObject(cacheRaw)
                  co.keys().asSequence().associateWith { k -> co.optString(k, "") }
                } catch (_: Throwable) { emptyMap() }
              } else {
                emptyMap()
              }
              android.util.Log.d("NitroWS", "[TokenRefresh] Using cached headers (${cached.size} header(s))")
              cached
            }

            android.util.Log.d("NitroWS", "[TokenRefresh] Injecting token headers into ${arr.length()} prewarm URL(s)")
            startPrewarms(arr, tokenHeaders)
          } catch (_: Throwable) {
            // Best-effort — never crash the app
          }
        }.start()
      } else {
        // No token refresh config — proceed on current thread (preConnect is non-blocking C++)
        startPrewarms(arr, emptyMap())
      }
    } catch (_: Throwable) {
      // Best-effort — never crash the app
    }
  }

  private fun startPrewarms(arr: JSONArray, tokenHeaders: Map<String, String>) {
    for (i in 0 until arr.length()) {
      val obj = arr.optJSONObject(i) ?: continue
      val url = obj.optString("url", null) ?: continue
      android.util.Log.d("NitroWS", "Pre-warming $url")

      val protocols = mutableListOf<String>()
      val protocolsArr = obj.optJSONArray("protocols")
      if (protocolsArr != null) {
        for (j in 0 until protocolsArr.length()) {
          protocolsArr.optString(j, null)?.let { protocols.add(it) }
        }
      }

      // Merge: static headers first, token headers override
      val merged = mutableMapOf<String, String>()
      val headersObj = obj.optJSONObject("headers")
      if (headersObj != null) {
        headersObj.keys().forEachRemaining { k ->
          merged[k] = headersObj.optString(k, "")
        }
      }
      tokenHeaders.forEach { (k, v) -> merged[k] = v }

      android.util.Log.d("NitroWS", "[TokenRefresh] Pre-warming $url with ${merged.size} header(s)")
      merged.forEach { (k, v) -> android.util.Log.d("NitroWS", "[TokenRefresh]   $k: $v") }
      NitroWebSocketPrewarmer.preWarm(url, protocols, merged)
    }
  }

  // MARK: - Token refresh (synchronous, runs on background thread)

  private fun callTokenRefreshSync(config: JSONObject): Map<String, String>? {
    return try {
      val urlStr = config.optString("url", null) ?: return null
      val method = config.optString("method", "POST")
      val reqHeaders = config.optJSONObject("headers")
      val body = config.optString("body", null)
      val responseType = config.optString("responseType", "json")

      val conn = URL(urlStr).openConnection() as HttpURLConnection
      conn.requestMethod = method
      conn.connectTimeout = 10_000
      conn.readTimeout = 10_000
      conn.doInput = true
      if (body != null) conn.doOutput = true

      reqHeaders?.keys()?.forEachRemaining { k ->
        conn.setRequestProperty(k, reqHeaders.optString(k, ""))
      }

      if (body != null) {
        conn.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
      }

      val status = conn.responseCode
      if (status !in 200..299) return null

      val responseBody = conn.inputStream.use { it.bufferedReader(Charsets.UTF_8).readText() }

      parseTokenResponse(responseBody, responseType, config)
    } catch (_: Throwable) {
      null
    }
  }

  private fun parseTokenResponse(
    body: String,
    responseType: String,
    config: JSONObject
  ): Map<String, String> {
    val result = mutableMapOf<String, String>()

    if (responseType == "text") {
      val textHeader = config.optString("textHeader", null)
      if (textHeader != null) {
        val textTemplate = config.optString("textTemplate", null)
        result[textHeader] = textTemplate?.replace("{{value}}", body) ?: body
      }
      return result
    }

    // JSON
    val json = try { JSONObject(body) } catch (_: Throwable) { return result }

    val mappings = config.optJSONArray("mappings")
    if (mappings != null) {
      for (i in 0 until mappings.length()) {
        val m = mappings.optJSONObject(i) ?: continue
        val jsonPath = m.optString("jsonPath", null) ?: continue
        val header = m.optString("header", null) ?: continue
        val value = getNestedField(json, jsonPath) ?: continue
        val tmpl = m.optString("valueTemplate", null)
        result[header] = tmpl?.replace("{{value}}", value) ?: value
      }
    }

    val compositeHeaders = config.optJSONArray("compositeHeaders")
    if (compositeHeaders != null) {
      for (i in 0 until compositeHeaders.length()) {
        val comp = compositeHeaders.optJSONObject(i) ?: continue
        val header = comp.optString("header", null) ?: continue
        val template = comp.optString("template", null) ?: continue
        val paths = comp.optJSONObject("paths") ?: continue
        var built = template
        paths.keys().forEachRemaining { ph ->
          val val2 = getNestedField(json, paths.optString(ph, ""))
          built = built.replace("{{$ph}}", val2 ?: "")
        }
        result[header] = built
      }
    }

    return result
  }

  private fun getNestedField(obj: JSONObject, dotPath: String): String? {
    val parts = dotPath.split(".")
    var current: Any = obj
    for (part in parts) {
      if (current !is JSONObject) return null
      current = current.opt(part) ?: return null
    }
    return current.toString()
  }
}
