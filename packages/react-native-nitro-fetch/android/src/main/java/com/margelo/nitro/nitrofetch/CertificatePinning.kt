package com.margelo.nitro.nitrofetch

import android.content.Context
import android.net.http.X509TrustManagerExtensions
import android.util.Base64
import org.chromium.net.CronetEngine
import org.json.JSONObject
import java.io.FileNotFoundException
import java.net.Socket
import java.net.URLConnection
import java.security.KeyStore
import java.security.MessageDigest
import java.security.cert.CertificateException
import java.security.cert.X509Certificate
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import javax.net.ssl.HttpsURLConnection
import javax.net.ssl.SSLContext
import javax.net.ssl.SSLEngine
import javax.net.ssl.SSLSocket
import javax.net.ssl.SSLSocketFactory
import javax.net.ssl.TrustManagerFactory
import javax.net.ssl.X509ExtendedTrustManager
import javax.net.ssl.X509TrustManager

/**
 * Optional public-key (SPKI) pinning for every connection NitroFetch opens: both Cronet engines and the
 * HttpURLConnection paths (cold-start token refresh, FormData parts fetched from a URL).
 *
 * Cronet uses its own BoringSSL trust stack and ignores network_security_config.xml, so the pins are
 * read from the app's `assets/nitro-fetch-pinning.json`. No file means pinning is off. A file that
 * can't be parsed throws, so a broken config fails every request instead of silently turning pinning off.
 *
 * Same file and shape as iOS (and as react-native-ssl-public-key-pinning's `initializeSslPinning`):
 *   { "api.example.com": { "publicKeyHashes": ["<base64 SHA-256 of the SPKI>", ...],
 *                          "includeSubdomains": false, "expirationDate": "2027-01-01" } }
 * A chain passes when any of its certificates (leaf, intermediate or trust-anchor root) has a pinned key.
 */
internal object CertificatePinning {
  const val CONFIG_FILE = "nitro-fetch-pinning.json"
  // Cronet's net error for a pin mismatch; HttpURLConnection failures reuse it so JS sees one marker.
  private const val ERROR_CODE = "ERR_SSL_PINNED_KEY_NOT_IN_CERT_CHAIN"

  // Cronet requires an expiration; without one the pins stay enforced until the app ships new ones.
  private val NO_EXPIRATION = Date(4102444800000L) // 2100-01-01 UTC

  private val HOSTNAME = Regex("^(?=.{1,253}$)[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$")
  private val NUMERIC_HOST = Regex("^[0-9.]+$")
  private val DATE = Regex("^\\d{4}-\\d{2}-\\d{2}$")

  private class DomainPins(
    val host: String,
    val hashes: Set<ByteArray>,
    val includeSubdomains: Boolean,
    val expiration: Date
  )

  // The file ships inside the APK, so it is read once and the result (or the error) reused.
  @Volatile private var cached: Result<Map<String, DomainPins>>? = null

  private val systemTrustManager: X509TrustManager by lazy {
    val factory = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm())
    factory.init(null as KeyStore?)
    factory.trustManagers.filterIsInstance<X509TrustManager>().first()
  }

  fun apply(builder: CronetEngine.Builder, context: Context) {
    val domains = domains(context)
    if (domains.isEmpty()) return
    // Cronet skips pins by default when the chain ends at a user-installed CA (e.g. a proxy); don't.
    builder.enablePublicKeyPinningBypassForLocalTrustAnchors(false)
    for (d in domains.values) {
      builder.addPublicKeyPins(d.host, d.hashes, d.includeSubdomains, d.expiration)
    }
  }

  /**
   * Pins an HTTPS [URLConnection]. The pins are checked by the trust manager during the handshake, before
   * any request bytes (headers, refresh tokens) are sent. The dedicated socket factory also keeps the
   * connection out of pools shared with unpinned HttpURLConnections. Call before connecting.
   */
  fun apply(connection: URLConnection, context: Context) {
    if (connection !is HttpsURLConnection) return
    val domains = domains(context)
    if (domains.isEmpty()) return
    connection.sslSocketFactory = socketFactory(domains)
  }

  @Volatile private var pinnedSocketFactory: SSLSocketFactory? = null

  private fun socketFactory(domains: Map<String, DomainPins>): SSLSocketFactory {
    pinnedSocketFactory?.let { return it }
    synchronized(this) {
      return pinnedSocketFactory ?: SSLContext.getInstance("TLS")
        .apply { init(null, arrayOf(PinningTrustManager(domains)), null) }
        .socketFactory
        .also { pinnedSocketFactory = it }
    }
  }

  /** The platform's validation (including network_security_config), then the pins of the host being connected to. */
  private class PinningTrustManager(private val domains: Map<String, DomainPins>) : X509ExtendedTrustManager() {
    override fun checkServerTrusted(chain: Array<X509Certificate>, authType: String, socket: Socket) =
      check(chain, authType, (socket as? SSLSocket)?.handshakeSession?.peerHost)

    override fun checkServerTrusted(chain: Array<X509Certificate>, authType: String, engine: SSLEngine) =
      check(chain, authType, engine.handshakeSession?.peerHost)

    // Without a socket there is no host to pin against; refuse rather than skip the check.
    override fun checkServerTrusted(chain: Array<X509Certificate>, authType: String) = check(chain, authType, null)

    override fun checkClientTrusted(chain: Array<X509Certificate>, authType: String): Unit =
      throw CertificateException("Client certificates aren't supported")

    override fun checkClientTrusted(chain: Array<X509Certificate>, authType: String, socket: Socket) =
      checkClientTrusted(chain, authType)

    override fun checkClientTrusted(chain: Array<X509Certificate>, authType: String, engine: SSLEngine) =
      checkClientTrusted(chain, authType)

    override fun getAcceptedIssuers(): Array<X509Certificate> = systemTrustManager.acceptedIssuers

    private fun check(chain: Array<X509Certificate>, authType: String, host: String?) {
      if (host == null) throw CertificateException("Certificate pinning: unknown host")
      // The verified chain runs up to the trust anchor, so a pinned root matches even though servers never send it.
      val verified = X509TrustManagerExtensions(systemTrustManager).checkServerTrusted(chain, authType, host)
      val pins = activePins(host, domains) ?: return
      val matched = verified.any { cert ->
        val digest = MessageDigest.getInstance("SHA-256").digest(cert.publicKey.encoded)
        pins.hashes.any { it.contentEquals(digest) }
      }
      if (!matched) {
        NitroLogger.e("NitroFetch", "Certificate pinning: no pinned key in the chain for $host")
        throw CertificateException("Certificate pinning failed for $host ($ERROR_CODE)")
      }
    }
  }

  /** The most specific entry covering [host]: an exact match, else the closest parent with includeSubdomains. */
  private fun activePins(host: String, domains: Map<String, DomainPins>): DomainPins? {
    var candidate = host.lowercase(Locale.US).removeSuffix(".")
    var pins = domains[candidate]
    while (pins == null && candidate.contains('.')) {
      candidate = candidate.substringAfter('.')
      pins = domains[candidate]?.takeIf { it.includeSubdomains }
    }
    // Expired entries don't pin, matching Cronet.
    return pins?.takeIf { it.expiration.after(Date()) }
  }

  private fun domains(context: Context): Map<String, DomainPins> {
    cached?.let { return it.getOrThrow() }
    synchronized(this) {
      val result = cached ?: runCatching { read(context)?.let(::parse) ?: emptyMap() }
        .onSuccess { if (it.isNotEmpty()) NitroLogger.i("NitroFetch", "Certificate pinning enabled for ${it.size} host(s)") }
        .onFailure { NitroLogger.e("NitroFetch", it.message ?: "Invalid $CONFIG_FILE", it) }
        .also { cached = it }
      return result.getOrThrow()
    }
  }

  private fun read(context: Context): String? = try {
    context.assets.open(CONFIG_FILE).bufferedReader().use { it.readText() }
  } catch (_: FileNotFoundException) {
    null
  }

  private fun parse(json: String): Map<String, DomainPins> {
    val root = try {
      JSONObject(json)
    } catch (e: Exception) {
      invalid("expected a JSON object keyed by hostname (${e.message})")
    }
    return root.keys().asSequence().map { key ->
      val host = key.trim().lowercase(Locale.US).removeSuffix(".")
      if (!HOSTNAME.matches(host) || NUMERIC_HOST.matches(host)) {
        invalid("\"$key\" is not a hostname (no scheme, port, path, wildcard or IP; use punycode for IDNs)")
      }
      val entry = root.optJSONObject(key) ?: invalid("\"$key\" must be an object")

      val rawHashes = entry.optJSONArray("publicKeyHashes")
      if (rawHashes == null || rawHashes.length() == 0) {
        invalid("\"$key\" needs at least one entry in publicKeyHashes")
      }
      val hashes = (0 until rawHashes.length()).map { i ->
        val raw = rawHashes.opt(i)
        val hash = (raw as? String)?.let { runCatching { Base64.decode(it, Base64.DEFAULT) }.getOrNull() }
        if (hash == null || hash.size != 32) {
          invalid("\"$key\" has a publicKeyHashes entry that isn't a base64 SHA-256 hash: $raw")
        }
        hash
      }.toSet()

      val includeSubdomains = when (val value = entry.opt("includeSubdomains")) {
        null -> false
        is Boolean -> value
        else -> invalid("\"$key\".includeSubdomains must be true or false")
      }

      val expiration = when (val value = entry.opt("expirationDate")) {
        null -> NO_EXPIRATION
        is String -> parseDate(value) ?: invalid("\"$key\".expirationDate must be yyyy-MM-dd")
        else -> invalid("\"$key\".expirationDate must be yyyy-MM-dd")
      }

      host to DomainPins(host, hashes, includeSubdomains, expiration)
    }.toMap()
  }

  private fun parseDate(value: String): Date? {
    if (!DATE.matches(value)) return null
    val format = SimpleDateFormat("yyyy-MM-dd", Locale.US).apply {
      timeZone = TimeZone.getTimeZone("UTC")
      isLenient = false
    }
    return runCatching { format.parse(value) }.getOrNull()
  }

  private fun invalid(reason: String): Nothing =
    throw IllegalStateException("NitroFetch: invalid $CONFIG_FILE: $reason")
}
