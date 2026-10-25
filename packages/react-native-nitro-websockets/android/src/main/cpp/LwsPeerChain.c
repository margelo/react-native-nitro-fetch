//
//  LwsPeerChain.c
//
//  Built into the libwebsockets target (see CMakeLists.txt): the certificate
//  chain the server sent is only reachable through lws's private headers.
//  lws_tls_peer_cert_info() returns the leaf alone, and mbedTLS builds have no
//  lws_get_ssl().
//
//  TODO: recheck on every libwebsockets upgrade that private-lib-core.h still
//  has wsi->tls.ssl and that ssl_get_peer_mbedtls_x509_crt() still returns the
//  whole peer chain.
//

#include "private-lib-core.h"

const mbedtls_x509_crt *nitro_ws_peer_chain(struct lws *wsi)
{
	if (!wsi || !wsi->tls.ssl)
		return NULL;

	return ssl_get_peer_mbedtls_x509_crt(wsi->tls.ssl);
}
