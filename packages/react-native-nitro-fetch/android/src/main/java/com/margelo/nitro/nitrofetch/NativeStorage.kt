package com.margelo.nitro.nitrofetch

import android.content.Context
import android.content.SharedPreferences
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import android.util.Log
import com.facebook.proguard.annotations.DoNotStrip
import com.margelo.nitro.NitroModules
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.spec.GCMParameterSpec

/**
 * Keystore-backed AES-GCM strings stored in [PREFS_NAME] with prefix [ENC_PREFIX].
 * Keep [KEYSTORE_ALIAS] and [ENC_PREFIX] in sync with `NitroWebSocketAutoPrewarmer.kt`.
 */
internal object NitroFetchSecureAtRest {
  internal const val PREFS_NAME = "nitro_fetch_storage"
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

  /** Plaintext for JSON parsing, or null if key absent. Migrates legacy plaintext to encrypted. */
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

  fun removeFromPrefs(prefs: SharedPreferences, key: String): Boolean {
    return prefs.edit().remove(key).commit()
  }
}

@DoNotStrip
class NativeStorage : HybridNativeStorageSpec() {

  companion object {
    private const val TAG = "HybridNativeStorage"

    private val sharedPreferences: SharedPreferences by lazy {
      val context =
        NitroModules.applicationContext
          ?: throw Error("Cannot get Android Context - No Context available!")
      context.getSharedPreferences(NitroFetchSecureAtRest.PREFS_NAME, Context.MODE_PRIVATE)
    }

  }

  override fun getString(key: String): String {
    return try {
      val value = sharedPreferences.getString(key, null)
      if (value != null) {
        Log.d(TAG, "Retrieved value for key: $key")
        value
      } else {
        Log.d(TAG, "Key not found: $key, returning empty string")
        ""
      }
    } catch (t: Throwable) {
      Log.e(TAG, "Error getting string for key: $key", t)
      throw RuntimeException("Failed to get string for key: $key", t)
    }
  }

  override fun setString(key: String, value: String) {
    try {
      val editor = sharedPreferences.edit()
      editor.putString(key, value)
      val success = editor.commit()
      if (success) {
        Log.d(TAG, "Successfully stored value for key: $key")
      } else {
        Log.e(TAG, "Failed to commit value for key: $key")
        throw RuntimeException("Failed to store value for key: $key")
      }
    } catch (t: Throwable) {
      Log.e(TAG, "Error setting string for key: $key", t)
      throw RuntimeException("Failed to set string for key: $key", t)
    }
  }

  override fun removeString(key: String) {
    try {
      val editor = sharedPreferences.edit()
      editor.remove(key)
      val success = editor.commit()
      if (success) {
        Log.d(TAG, "Successfully deleted key: $key")
      } else {
        Log.e(TAG, "Failed to commit deletion for key: $key")
        throw RuntimeException("Failed to delete key: $key")
      }
    } catch (t: Throwable) {
      Log.e(TAG, "Error deleting key: $key", t)
      throw RuntimeException("Failed to delete key: $key", t)
    }
  }

  override fun getSecureString(key: String): String {
    return try {
      NitroFetchSecureAtRest.getDecryptedForPrefs(sharedPreferences, key) ?: ""
    } catch (t: Throwable) {
      Log.e(TAG, "Error getSecureString for key: $key", t)
      throw RuntimeException("Failed to get secure string for key: $key", t)
    }
  }

  override fun setSecureString(key: String, value: String) {
    try {
      val ok = NitroFetchSecureAtRest.putEncrypted(sharedPreferences, key, value)
      if (!ok) throw RuntimeException("commit failed")
    } catch (t: Throwable) {
      Log.e(TAG, "Error setSecureString for key: $key", t)
      throw RuntimeException("Failed to set secure string for key: $key", t)
    }
  }

  override fun removeSecureString(key: String) {
    try {
      val ok = NitroFetchSecureAtRest.removeFromPrefs(sharedPreferences, key)
      if (!ok) throw RuntimeException("commit failed")
    } catch (t: Throwable) {
      Log.e(TAG, "Error removeSecureString for key: $key", t)
      throw RuntimeException("Failed to remove secure string for key: $key", t)
    }
  }
}
