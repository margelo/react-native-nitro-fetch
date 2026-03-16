package com.margelo.nitro.nitrofetch

import android.app.Application
import android.content.Context
import android.content.SharedPreferences
import android.util.Log
import com.facebook.proguard.annotations.DoNotStrip
import com.margelo.nitro.NitroModules



@DoNotStrip
class NativeStorage : HybridNativeStorageSpec() {

    companion object {
        private const val TAG = "HybridNativeStorage"
        private const val PREFS_NAME = "nitro_fetch_storage"

       
        private val sharedPreferences: SharedPreferences by lazy {
            val context = NitroModules.applicationContext ?: throw Error("Cannot get Android Context - No Context available!")
            context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        }


    }

    /**
     * Retrieves a string value for the given key.
     *
     * @param key The key to look up in storage
     * @return The stored string value, or empty string if key doesn't exist
     * @throws IllegalStateException if SharedPreferences is not available
     */
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

    /**
     * Stores a string value with the given key.
     *
     * @param key The key to store the value under
     * @param value The string value to store
     * @throws IllegalStateException if SharedPreferences is not available
     * @throws RuntimeException if the write operation fails
     */
    override fun setString(key: String, value: String) {
        try {
            val editor = sharedPreferences.edit()
            editor.putString(key, value)
            val success = editor.commit() // commit() is synchronous and returns boolean
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

    /**
     * Deletes the value associated with the given key.
     * If the key doesn't exist, this is a no-op.
     *
     * @param key The key to delete from storage
     * @throws IllegalStateException if SharedPreferences is not available
     * @throws RuntimeException if the delete operation fails
     */
    override fun removeString(key: String) {
        try {
            val editor = sharedPreferences.edit()
            editor.remove(key)
            val success = editor.commit() // commit() is synchronous and returns boolean
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
}


