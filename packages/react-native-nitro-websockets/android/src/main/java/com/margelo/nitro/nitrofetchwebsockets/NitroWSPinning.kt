package com.margelo.nitro.nitrofetchwebsockets

import android.content.Context
import android.net.http.X509TrustManagerExtensions
import android.util.Base64
import android.util.JsonReader
import android.util.JsonToken
import com.facebook.proguard.annotations.DoNotStrip
import com.margelo.nitro.NitroModules
import java.io.ByteArrayInputStream
import java.io.FileNotFoundException
import java.io.StringReader
import java.net.URLConnection
import java.security.KeyStore
import java.security.MessageDigest
import java.security.cert.CertificateFactory
import java.security.cert.X509Certificate
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import javax.net.ssl.HostnameVerifier
import javax.net.ssl.HttpsURLConnection
import javax.net.ssl.TrustManagerFactory
import javax.net.ssl.X509TrustManager

/**
 * Duplicate of nitro-fetch's CertificatePinning.kt (pin file parsing and host matching) for
 * wss:// and the cold-start token refresh. nitro-websockets can't depend on nitro-fetch, so keep
 * the two in sync.
 *
 * A pinned host's chain must pass the platform's validation (including network_security_config)
 * and contain a pinned key, as with fetch. Other hosts keep the transport's own validation.
 */
@DoNotStrip
internal object NitroWSPinning {
  private const val CONFIG_FILE = "nitro-fetch-pinning.json"
  private const val ERROR_CODE = "ERR_SSL_PINNED_KEY_NOT_IN_CERT_CHAIN"

  // Cronet requires an expiration; without one the pins stay enforced until the app ships new ones.
  private val NO_EXPIRATION = Date(4102444800000L) // 2100-01-01 UTC

  private val HOSTNAME by lazy { Regex("^(?=.{1,253}$)[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$") }
  private val NUMERIC_HOST by lazy { Regex("^[0-9.]+$") }
  private val DATE by lazy { Regex("^\\d{4}-\\d{2}-\\d{2}$") }
  private val HASH by lazy { Regex("^[A-Za-z0-9+/]{43}=$") }

  private class DomainPins(val hashes: Set<ByteArray>, val includeSubdomains: Boolean, val expiration: Date)

  /** A leaf certificate that passed the check, and the pin entry it passed under. */
  private class VerifiedLeaf(val sha256: ByteArray, val pins: DomainPins)

  // More than lws keeps TLS sessions (10), so a session lws can resume still has its leaf here.
  private const val MAX_VERIFIED_LEAVES = 16

  /** By "host:port", like lws's TLS session cache. Least recently used first. */
  private val verifiedLeaves = object : LinkedHashMap<String, VerifiedLeaf>(MAX_VERIFIED_LEAVES, 0.75f, true) {
    override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, VerifiedLeaf>) = size > MAX_VERIFIED_LEAVES
  }

  /**
   * Set when the process starts by [NitroWSContextProvider], before Application.onCreate, where
   * React Native has no context yet. [NitroWebSocketAutoPrewarmer.prewarmOnStart] sets it too.
   */
  @Volatile var application: Context? = null

  // The file ships inside the APK, so it is read once and the result (or the error) reused.
  @Volatile private var cached: Result<Map<String, DomainPins>>? = null

  private val trustExtensions by lazy {
    val factory = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm())
    factory.init(null as KeyStore?)
    X509TrustManagerExtensions(factory.trustManagers.filterIsInstance<X509TrustManager>().first())
  }

  /**
   * Whether the app ships a pin file. Asked once by cpp-adapter.cpp: without one, wss:// connections
   * skip the check. True when the file can't be read, so every connection asks [isPinned].
   */
  @DoNotStrip
  @JvmStatic
  fun hasPins(): Boolean = try {
    domains().isNotEmpty()
  } catch (_: Exception) {
    true
  }

  /** Whether a wss:// connection to [host] must pass [checkServerTrusted]: every host when the file is invalid. */
  @DoNotStrip
  @JvmStatic
  fun isPinned(host: String): Boolean = try {
    activePins(host, domains()) != null
  } catch (_: Exception) {
    true
  }

  /**
   * Called by cpp-adapter.cpp for a pinned host once the TLS handshake of a wss:// connection to
   * [host]:[port] is done, before the handshake request (and its headers) is sent. [chain] is the DER
   * chain the server sent, leaf first. Returns null if the connection may proceed, or the error to
   * fail it with.
   *
   * A resumed TLS session hands over only the leaf certificate it was set up with, not a chain the
   * platform can always verify. It passes when that exact leaf passed this check for [host]:[port]
   * under the same pin entry, which must still apply. Otherwise the leaf alone goes through the full
   * check, which fails unless the platform builds a trusted chain with a pinned key from it.
   */
  @DoNotStrip
  @JvmStatic
  fun checkServerTrusted(host: String, port: Int, chain: Array<ByteArray>): String? {
    val pins = try {
      activePins(host, domains()) ?: return null
    } catch (e: Exception) {
      return "Certificate pinning failed for $host: ${e.message}"
    }
    val key = "$host:$port"
    val leaf = chain.firstOrNull()?.let { MessageDigest.getInstance("SHA-256").digest(it) }
    if (chain.size == 1) {
      val remembered = synchronized(verifiedLeaves) { verifiedLeaves[key] }
      if (remembered != null && remembered.pins === pins && remembered.sha256.contentEquals(leaf)) return null
    }
    val error = verify(host, pins) {
      val factory = CertificateFactory.getInstance("X.509")
      chain.map { factory.generateCertificate(ByteArrayInputStream(it)) as X509Certificate }
    }
    if (error == null && leaf != null) synchronized(verifiedLeaves) { verifiedLeaves[key] = VerifiedLeaf(leaf, pins) }
    return error
  }

  /** Pins the token refresh [connection] like nitro-fetch pins its own. Call before connecting. */
  fun apply(connection: URLConnection) {
    if (connection !is HttpsURLConnection || domains().isEmpty()) return
    val platform = connection.hostnameVerifier
    // Runs once the TLS handshake is done, before the request (and its tokens) is sent.
    connection.hostnameVerifier = HostnameVerifier { host, session ->
      platform.verify(host, session) && check(host) { session.peerCertificates.map { it as X509Certificate } } == null
    }
  }

  /**
   * Null if [host] is unpinned or its [chain] passes: the platform must accept it, and any
   * certificate of the verified chain (leaf, intermediate or the trust anchor's root) must have a
   * pinned key. Otherwise the error to fail the connection with.
   */
  private fun check(host: String, chain: () -> List<X509Certificate>): String? {
    val pins = try {
      activePins(host, domains()) ?: return null
    } catch (e: Exception) {
      return "Certificate pinning failed for $host: ${e.message}"
    }
    return verify(host, pins, chain)
  }

  private fun verify(host: String, pins: DomainPins, chain: () -> List<X509Certificate>): String? {
    val verified = try {
      // TLS 1.3 has no key exchange in the cipher suite; Conscrypt passes "GENERIC" for it too.
      trustExtensions.checkServerTrusted(chain().toTypedArray(), "GENERIC", host)
    } catch (e: Exception) {
      return "The certificate for $host is not trusted (${e.message})"
    }
    val matched = verified.any { cert ->
      val digest = MessageDigest.getInstance("SHA-256").digest(cert.publicKey.encoded)
      pins.hashes.any { it.contentEquals(digest) }
    }
    if (matched) return null
    NitroLogger.e("NitroWS", "Certificate pinning: no pinned key in the chain for $host")
    return "Certificate pinning failed for $host ($ERROR_CODE)"
  }

  /**
   * The pins covering [host], by Cronet's rule like nitro-fetch: walk up from the full host, skip
   * expired entries, and let the first live entry decide. It applies if it is an exact match or has
   * includeSubdomains; otherwise the host is unpinned, even if a parent entry has includeSubdomains.
   */
  private fun activePins(host: String, domains: Map<String, DomainPins>): DomainPins? {
    val now = Date()
    var candidate = host.lowercase(Locale.US).removeSuffix(".")
    var exact = true
    while (true) {
      val pins = domains[candidate]
      if (pins != null && pins.expiration.after(now)) return pins.takeIf { exact || it.includeSubdomains }
      if (!candidate.contains('.')) return null
      candidate = candidate.substringAfter('.')
      exact = false
    }
  }

  private fun domains(): Map<String, DomainPins> {
    cached?.let { return it.getOrThrow() }
    // Without a Context the file can't be read, and guessing "no pins" would fail open.
    val context = application ?: NitroModules.applicationContext
      ?: throw IllegalStateException("can't read $CONFIG_FILE without an Android Context")
    synchronized(this) {
      val result = cached ?: runCatching { read(context)?.let(::parse) ?: emptyMap() }
        .onFailure { NitroLogger.e("NitroWS", it.message ?: "Invalid $CONFIG_FILE", it) }
        .also { cached = it }
      return result.getOrThrow()
    }
  }

  private fun read(context: Context): String? = try {
    context.assets.open(CONFIG_FILE).bufferedReader().use { it.readText() }
  } catch (_: FileNotFoundException) {
    null
  }

  /** Strict JSON, as on iOS and in the Expo plugin: no comments, unquoted names or trailing content. */
  private fun parse(json: String): Map<String, DomainPins> = try {
    JsonReader(StringReader(json)).use { reader ->
      reader.isLenient = false
      if (reader.peek() != JsonToken.BEGIN_OBJECT) invalid("expected a JSON object keyed by hostname")
      val domains = LinkedHashMap<String, DomainPins>()
      reader.beginObject()
      while (reader.hasNext()) {
        val key = reader.nextName()
        val host = key.lowercase(Locale.US).removeSuffix(".")
        if (!HOSTNAME.matches(host) || NUMERIC_HOST.matches(host)) {
          invalid("\"$key\" is not a hostname (no scheme, port, path, wildcard or IP; use punycode for IDNs)")
        }
        if (host in domains) invalid("\"$key\" lists a host that is already in the file")
        domains[host] = readEntry(reader, key)
      }
      reader.endObject()
      if (reader.peek() != JsonToken.END_DOCUMENT) invalid("unexpected content after the JSON object")
      domains
    }
  } catch (e: InvalidConfig) {
    throw e
  } catch (e: Exception) {
    invalid("not valid JSON (${e.message})")
  }

  private fun readEntry(reader: JsonReader, key: String): DomainPins {
    if (reader.peek() != JsonToken.BEGIN_OBJECT) invalid("\"$key\" must be an object")
    var hashes = emptySet<ByteArray>()
    var includeSubdomains = false
    var expiration = NO_EXPIRATION
    reader.beginObject()
    while (reader.hasNext()) {
      when (reader.nextName()) {
        "publicKeyHashes" -> {
          if (reader.peek() != JsonToken.BEGIN_ARRAY) invalid("\"$key\" needs at least one entry in publicKeyHashes")
          val decoded = mutableSetOf<ByteArray>()
          reader.beginArray()
          while (reader.hasNext()) {
            val raw = if (reader.peek() == JsonToken.STRING) reader.nextString() else null
            if (raw == null || !HASH.matches(raw)) {
              invalid("\"$key\" has a publicKeyHashes entry that isn't a base64 SHA-256 hash: ${raw ?: reader.peek()}")
            }
            decoded += Base64.decode(raw, Base64.DEFAULT)
          }
          reader.endArray()
          hashes = decoded
        }
        "includeSubdomains" -> {
          if (reader.peek() != JsonToken.BOOLEAN) invalid("\"$key\".includeSubdomains must be true or false")
          includeSubdomains = reader.nextBoolean()
        }
        "expirationDate" -> {
          val raw = if (reader.peek() == JsonToken.STRING) reader.nextString() else null
          expiration = raw?.let(::parseDate) ?: invalid("\"$key\".expirationDate must be yyyy-MM-dd")
        }
        else -> reader.skipValue()
      }
    }
    reader.endObject()
    if (hashes.isEmpty()) invalid("\"$key\" needs at least one entry in publicKeyHashes")
    return DomainPins(hashes, includeSubdomains, expiration)
  }

  private fun parseDate(value: String): Date? {
    if (!DATE.matches(value)) return null
    val format = SimpleDateFormat("yyyy-MM-dd", Locale.US).apply {
      timeZone = TimeZone.getTimeZone("UTC")
      isLenient = false
    }
    return runCatching { format.parse(value) }.getOrNull()
  }

  private class InvalidConfig(reason: String) : IllegalStateException("invalid $CONFIG_FILE: $reason")

  private fun invalid(reason: String): Nothing = throw InvalidConfig(reason)
}
