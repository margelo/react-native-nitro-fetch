package com.margelo.nitro.nitrofetch

import org.json.JSONObject

// isNull() maps both a missing key and an explicit JSON null to null, without optString(name, null)'s @NonNull warning.
internal fun JSONObject.optStringOrNull(name: String): String? =
  if (isNull(name)) null else optString(name)
