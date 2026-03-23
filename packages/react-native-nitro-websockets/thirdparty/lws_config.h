/* lws_config.h  Generated from lws_config.h.in  */

#ifndef NDEBUG
	#ifndef _DEBUG
		#define _DEBUG
	#endif
#endif

#define LWS_INSTALL_DATADIR ""
#define LWS_INSTALL_LIBDIR ""
#define LWS_LIBRARY_VERSION_MAJOR 4
#define LWS_LIBRARY_VERSION_MINOR 5
#define LWS_LIBRARY_VERSION_PATCH_ELABORATED 0-v4.5.0
#define LWS_LIBRARY_VERSION_PATCH 0

/* LWS_LIBRARY_VERSION_NUMBER looks like 1005001 for e.g. version 1.5.1 */
#define LWS_LIBRARY_VERSION_NUMBER (LWS_LIBRARY_VERSION_MAJOR * 1000000) + \
					(LWS_LIBRARY_VERSION_MINOR * 1000) + \
					LWS_LIBRARY_VERSION_PATCH
#define LWS_MAX_SMP 1

/* #undef LWS_ESP_PLATFORM */
/* #undef LWS_LIBRARY_VERSION_NUMBER */

/* #undef LWS_EXT_PTHREAD_LIBRARIES */

/* #undef LWS_AVOID_SIGPIPE_IGN */
#define LWS_BUILD_HASH "v4.5.0"
/* #undef LWS_BUILTIN_GETIFADDRS */
/* #undef LWS_BUILTIN_PLUGIN_NAMES */
#define LWS_CLIENT_HTTP_PROXYING
#define LWS_DETECTED_PLAT_IOS
/* #undef LWS_FALLBACK_GETHOSTBYNAME */
#define LWS_HAS_INTPTR_T
#define LWS_HAS_GETOPT_LONG
/* #undef LWS_HAVE__ATOI64 */
#define LWS_HAVE_ATOLL
/* #undef LWS_HAVE_BN_bn2binpad */
#define LWS_HAVE_CLOCK_GETTIME
/* #undef LWS_HAVE_EC_POINT_get_affine_coordinates */
/* #undef LWS_HAVE_EC_KEY_new_by_curve_name */
/* #undef LWS_HAVE_ECDSA_SIG_set0 */
/* #undef LWS_HAVE_EVP_MD_CTX_free */
/* #undef LWS_HAVE_EVP_aes_128_wrap */
/* #undef LWS_HAVE_EVP_aes_128_cfb8 */
/* #undef LWS_HAVE_EVP_aes_128_cfb128 */
/* #undef LWS_HAVE_EVP_aes_192_cfb8 */
/* #undef LWS_HAVE_EVP_aes_192_cfb128 */
/* #undef LWS_HAVE_EVP_aes_256_cfb8 */
/* #undef LWS_HAVE_EVP_aes_256_cfb128 */
/* #undef LWS_HAVE_EVP_aes_128_ofb */
/* #undef LWS_HAVE_EVP_aes_128_xts */
/* #undef LWS_HAVE_EVP_aes_128_ctr */
/* #undef LWS_HAVE_EVP_aes_128_ecb */
/* #undef LWS_HAVE_EVP_PKEY_new_raw_private_key */
/* #undef LWS_HAVE_EXECVPE */
#define LWS_HAVE_LOCALTIME_R
#define LWS_HAVE_GMTIME_R
#define LWS_HAVE_CTIME_R
#define LWS_HAVE_GETGRGID_R
#define LWS_HAVE_GETGRNAM_R
#define LWS_HAVE_GETPWUID_R
#define LWS_HAVE_GETPWNAM_R
/* #undef LWS_HAVE_LIBCAP */
/* #undef LWS_HAVE_HMAC_CTX_new */
/* #undef LWS_HAVE_MALLOC_H */
/* #undef LWS_HAVE_MALLOC_TRIM */
/* #undef LWS_HAVE_MALLOC_USABLE_SIZE */
#define LWS_HAVE_mbedtls_md_setup
#define LWS_HAVE_mbedtls_net_init
#define LWS_HAVE_mbedtls_rsa_complete
/* #undef LWS_HAVE_mbedtls_internal_aes_encrypt */
#define LWS_HAVE_mbedtls_ssl_conf_alpn_protocols
#define LWS_HAVE_mbedtls_ssl_get_alpn_protocol
#define LWS_HAVE_mbedtls_ssl_conf_sni
#define LWS_HAVE_mbedtls_ssl_set_hs_ca_chain
#define LWS_HAVE_mbedtls_ssl_set_hs_own_cert
#define LWS_HAVE_mbedtls_ssl_set_hs_authmode
#define LWS_HAVE_mbedtls_ssl_set_verify
#define LWS_HAVE_mbedtls_x509_crt_parse_file
#define LWS_HAVE_MBEDTLS_NET_SOCKETS
#define LWS_HAVE_MBEDTLS_SSL_NEW_SESSION_TICKET
#define LWS_HAVE_MBEDTLS_AUTH_KEY_ID
/* #undef LWS_HAVE_NEW_UV_VERSION_H */
/* #undef LWS_HAVE_OPENSSL_ECDH_H */
/* #undef LWS_HAVE_OPENSSL_STACK */
/* #undef LWS_HAVE_PIPE2 */
/* #undef LWS_HAVE_EVENTFD */
#define LWS_HAVE_PTHREAD_H
/* #undef LWS_HAVE_RSA_SET0_KEY */
/* #undef LWS_HAVE_RSA_verify_pss_mgf1 */
/* #undef LWS_HAVE_SSL_CTX_get0_certificate */
/* #undef LWS_HAVE_SSL_CTX_load_verify_file */
/* #undef LWS_HAVE_SSL_CTX_load_verify_dir */
/* #undef LWS_HAVE_SSL_CTX_set1_param */
/* #undef LWS_HAVE_SSL_CTX_set_ciphersuites */
/* #undef LWS_HAVE_SSL_CTX_set_keylog_callback */
/* #undef LWS_HAVE_SSL_CTX_SET_ECDH_AUTO */
/* #undef LWS_HAVE_SSL_EXTRA_CHAIN_CERTS */
/* #undef LWS_HAVE_SSL_get0_alpn_selected */
/* #undef LWS_HAVE_SSL_CTX_EVP_PKEY_new_raw_private_key */
/* #undef LWS_HAVE_SSL_set_alpn_protos */
/* #undef LWS_HAVE_SSL_set_tlsext_host_name */
/* #undef LWS_HAVE_SSL_SET_INFO_CALLBACK */
/* #undef LWS_HAVE_SSL_SESSION_set_time */
/* #undef LWS_HAVE_SSL_SESSION_up_ref */
/* #undef LWS_HAVE__STAT32I64 */
#define LWS_HAVE_STDINT_H
#define LWS_HAVE_SYS_TYPES_H
/* #undef LWS_HAVE_SYS_CAPABILITY_H */
#define LWS_HAVE_TIMEGM
/* #undef LWS_HAVE_TLS_CLIENT_METHOD */
/* #undef LWS_HAVE_TLSV1_2_CLIENT_METHOD */
#define LWS_HAVE_SUSECONDS_T
/* #undef LWS_HAVE_UV_VERSION_H */
#define LWS_HAVE_VFORK
/* #undef LWS_HAVE_X509_get_key_usage */
/* #undef LWS_HAVE_X509_VERIFY_PARAM_set1_host */
#define LWS_LIBRARY_VERSION "4.5.0-v4.5.0"
#define LWS_LOGGING_BITFIELD_CLEAR 0
#define LWS_LOGGING_BITFIELD_SET 0
#define LWS_LOG_TAG_LIFECYCLE
/* #undef LWS_MINGW_SUPPORT */
/* #undef LWS_NO_CLIENT */
#define LWS_NO_DAEMONIZE
/* #undef LWS_ONLY_SSPC */
#define LWS_OPENSSL_CLIENT_CERTS "../share"
#define LWS_OPENSSL_SUPPORT
/* #undef LWS_OTA_PUBLIC_JWK */
#define LWS_OTA_VARIANT "set-LWS_OTA_VARIANT"
/* #undef LWS_PLAT_OPTEE */
#define LWS_PLAT_UNIX
/* #undef LWS_PLAT_FREERTOS */
/* #undef LWS_PLAT_BAREMETAL */
/* #undef LWS_ROLE_CGI */
/* #undef LWS_ROLE_DBUS */
#define LWS_ROLE_H1
/* #undef LWS_ROLE_H2 */
#define LWS_ROLE_RAW
#define LWS_ROLE_RAW_FILE
/* #undef LWS_ROLE_RAW_PROXY */
#define LWS_ROLE_WS
/* #undef LWS_ROLE_MQTT */
/* #undef LWS_SHA1_USE_OPENSSL_NAME */
#define LWS_SSL_CLIENT_USE_OS_CA_CERTS
/* #undef LWS_SSL_SERVER_WITH_ECDH_CERT */
#define LWS_SUPPRESS_DEPRECATED_API_WARNINGS
/* #undef LWS_TLS_LOG_PLAINTEXT_RX */
/* #undef LWS_TLS_LOG_PLAINTEXT_TX */
/* #undef LWS_WITH_ABSTRACT */
/* #undef LWS_WITH_ACCESS_LOG */
/* #undef LWS_WITH_ACME */
/* #undef LWS_WITH_ALLOC_METADATA_LWS */
/* #undef LWS_WITH_ALSA */
/* #undef LWS_WITH_SYS_ASYNC_DNS */
/* #undef LWS_WITH_BORINGSSL */
/* #undef LWS_WITH_AWSLC */
/* #undef LWS_WITH_CGI */
/* #undef LWS_WITH_COMPRESSED_BACKTRACES */
#define LWS_COMPRESSED_BACKTRACES_SNIP_PRE 2
#define LWS_COMPRESSED_BACKTRACES_SNIP_POST 1
#define LWS_WITH_CONMON
/* #undef LWS_WITH_COSE */
#define LWS_WITH_CUSTOM_HEADERS
/* #undef LWS_WITH_DEPRECATED_LWS_DLL */
/* #undef LWS_WITH_DETAILED_LATENCY */
#define LWS_WITH_DIR
#define LWS_WITH_DLO
/* #undef LWS_WITH_DRIVERS */
/* #undef LWS_WITH_ESP32 */
#define LWS_HAVE_NET_ETHERNET_H
/* #undef LWS_HAVE_EVBACKEND_LINUXAIO */
/* #undef LWS_HAVE_EVBACKEND_IOURING */
/* #undef LWS_WITH_EXTERNAL_POLL */
#define LWS_WITH_FILE_OPS
/* #undef LWS_WITH_FSMOUNT */
/* #undef LWS_WITH_FTS */
#define LWS_WITH_GENCRYPTO
/* #undef LWS_WITH_GENERIC_SESSIONS */
/* #undef LWS_WITH_GLIB */
/* #undef LWS_WITH_GTK */
#define LWS_WITH_GZINFLATE
/* #undef LWS_WITH_HTTP2 */
#define LWS_WITH_HTTP_BASIC_AUTH
#define LWS_WITH_HTTP_DIGEST_AUTH
/* #undef LWS_WITH_HTTP_BROTLI */
/* #undef LWS_HTTP_HEADERS_ALL */
/* #undef LWS_WITH_HTTP_PROXY */
/* #undef LWS_WITH_HTTP_STREAM_COMPRESSION */
#define LWS_WITH_HTTP_UNCOMMON_HEADERS
/* #undef LWS_WITH_IPV6 */
/* #undef LWS_WITH_JOSE */
/* #undef LWS_WITH_CBOR */
#define LWS_WITH_CBOR_FLOAT
#define LWS_WITH_JSONRPC
#define LWS_WITH_LEJP
#define LWS_WITH_LHP
/* #undef LWS_WITH_LIBEV */
/* #undef LWS_WITH_LIBEVENT */
/* #undef LWS_WITH_LIBUV */
/* #undef LWS_WITH_SDEVENT */
#define LWS_WITH_LWSAC
#define LWS_LOGS_TIMESTAMP
#define LWS_WITH_MBEDTLS
/* #undef LWS_WITH_MINIZ */
/* #undef LWS_WITH_NETLINK */
/* #undef LWS_WITH_BINDTODEVICE */
#define LWS_WITH_NETWORK
/* #undef LWS_WITH_NO_LOGS */
/* #undef LWS_WITH_OTA */
#define LWS_WITH_CACHE_NSCOOKIEJAR
#define LWS_WITH_CLIENT
#define LWS_WITHOUT_EXTENSIONS
/* #undef LWS_WITH_SERVER */
/* #undef LWS_WITH_SPAWN */
/* #undef LWS_WITH_PEER_LIMITS */
#define LWS_WITH_JPEG
/* #undef LWS_WITH_PLUGINS */
/* #undef LWS_WITH_PLUGINS_BUILTIN */
/* #undef LWS_WITH_POLARSSL */
#define LWS_WITH_POLL
/* #undef LWS_WITH_RANGES */
/* #undef LWS_WITH_RFC6724 */
#define LWS_WITH_SECURE_STREAMS
/* #undef LWS_WITH_SECURE_STREAMS_CPP */
/* #undef LWS_WITH_SECURE_STREAMS_SYS_AUTH_API_AMAZON_COM */
/* #undef LWS_WITH_SECURE_STREAMS_PROXY_API */
/* #undef LWS_WITH_SECURE_STREAMS_STATIC_POLICY_ONLY */
/* #undef LWS_WITH_SECURE_STREAMS_AUTH_SIGV4 */
/* #undef LWS_WITH_SECURE_STREAMS_BUFFER_DUMP */
/* #undef LWS_WITH_SS_DIRECT_PROTOCOL_STR */
/* #undef LWS_WITH_SELFTESTS */
/* #undef LWS_WITH_SEQUENCER */
/* #undef LWS_WITH_SERVER_STATUS */
#define LWS_WITH_SYS_SMD
/* #undef LWS_WITH_SMTP */
/* #undef LWS_WITH_SOCKS5 */
/* #undef LWS_WITH_STATEFUL_URLDECODE */
/* #undef LWS_WITH_STATS */
/* #undef LWS_WITH_STRUCT_SQLITE3 */
/* #undef LWS_WITH_STRUCT_JSON */
/* #undef LWS_WITH_SUL_DEBUGGING */
/* #undef LWS_WITH_SQLITE3 */
/* #undef LWS_WITH_SYS_DHCP_CLIENT */
/* #undef LWS_WITH_SYS_FAULT_INJECTION */
/* #undef LWS_WITH_SYS_METRICS */
/* #undef LWS_WITH_SYS_NTPCLIENT */
#define LWS_WITH_SYS_STATE
/* #undef LWS_HAVE_SYSTEMD_H */
#define LWS_WITHOUT_TEST_SERVER
#define LWS_WITHOUT_TESTAPPS
/* #undef LWS_WITH_THREADPOOL */
#define LWS_WITH_TLS
/* #undef LWS_WITH_TLS_JIT_TRUST */
#define LWS_WITH_TLS_SESSIONS
#define LWS_WITH_UDP
/* #undef LWS_WITH_ULOOP */
#define LWS_WITH_UNIX_SOCK
#define LWS_WITH_UPNG
/* #undef LWS_WITH_ZIP_FOPS */
/* #undef USE_OLD_CYASSL */
/* #undef USE_WOLFSSL */
/* #undef LWS_WITH_EVENT_LIBS */
/* #undef LWS_WITH_EVLIB_PLUGINS */
/* #undef LWS_WITH_LIBUV_INTERNAL */
/* #undef LWS_WITH_PLUGINS_API */
/* #undef LWS_HAVE_RTA_PREF */
/* #undef PICO_SDK_PATH */
/* #undef LWS_HAVE_LINUX_IPV6_H */
#define LWS_WITH_WOL
/* #undef LWS_HAVE_NET_IF_ETHER_H */
/* #undef LWS_WITH_WAKE_LOGGING */
