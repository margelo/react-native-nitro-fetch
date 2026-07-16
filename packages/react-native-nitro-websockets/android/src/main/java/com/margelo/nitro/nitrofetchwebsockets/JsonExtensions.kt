package com.margelo.nitro.nitrofetchwebsockets

import org.json.JSONObject

// `optString(name, null)` warns because the `fallback` parameter is annotated @NonNull.
// Guards on `has` rather than `isNull` to keep the existing behaviour exactly: `optString`
// coerces the JSONObject.NULL sentinel to the string "null", so an explicit `"key": null`
// returns "null" and only an absent key returns null.
internal fun JSONObject.optStringOrNull(name: String): String? =
  if (has(name)) optString(name) else null
