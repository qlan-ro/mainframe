//! Loopback classification + trust-proxy client-IP derivation, shared by the
//! HTTP auth middleware (`middleware/auth.rs`) and the WS upgrade
//! (`websocket.rs`). Both follow the same trust-loopback-proxies rule; the WS
//! upgrade does not use a first-hop rule, which a forged header could spoof.

/// The loopback peers trusted as proxies (note the IPv4-mapped IPv6 form).
pub const LOCALHOST_IPS: [&str; 3] = ["127.0.0.1", "::1", "::ffff:127.0.0.1"];

/// True when `ip` is one of the trusted loopback addresses.
pub(crate) fn is_localhost(ip: &str) -> bool {
    LOCALHOST_IPS.contains(&ip)
}

/// Derives the effective client IP with loopback hops trusted as proxies, which
/// is what the HTTP auth middleware, every route reading the client IP, and the
/// WS upgrade all see. It returns the *leftmost untrusted* address: it walks
/// the peer + reversed `x-forwarded-for` chain from nearest to furthest,
/// skipping trusted (loopback) hops, and stops at the first non-loopback
/// address. A forged leftmost `127.0.0.1` therefore cannot spoof a loopback
/// client through the cloudflared tunnel — the real appended hop wins.
pub(crate) fn trust_proxy_client_ip(raw_peer_ip: &str, forwarded_for: Option<&str>) -> String {
    // If the direct peer is untrusted, `x-forwarded-for` is not honored at all.
    if !is_localhost(raw_peer_ip) {
        return raw_peer_ip.to_string();
    }
    if let Some(fwd) = forwarded_for {
        for hop in fwd.split(',').rev() {
            let hop = hop.trim();
            if hop.is_empty() || is_localhost(hop) {
                continue;
            }
            return hop.to_string();
        }
    }
    // Every hop (peer + chain) is loopback — the effective client is loopback.
    raw_peer_ip.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn loopback_variants_are_localhost() {
        assert!(is_localhost("127.0.0.1"));
        assert!(is_localhost("::1"));
        assert!(is_localhost("::ffff:127.0.0.1"));
        assert!(!is_localhost("192.168.1.100"));
    }

    #[test]
    fn trust_proxy_takes_leftmost_untrusted_hop() {
        // The tunnel attack: a forged leftmost 127.0.0.1 must NOT spoof loopback.
        // proxy-addr walks right-to-left past the trusted loopback hop and stops
        // at the appended real client.
        assert_eq!(
            trust_proxy_client_ip("127.0.0.1", Some("127.0.0.1, 203.0.113.7")),
            "203.0.113.7"
        );
        // Normal chain: real client is leftmost, proxy hops are loopback.
        assert_eq!(
            trust_proxy_client_ip("127.0.0.1", Some("203.0.113.7, 127.0.0.1")),
            "203.0.113.7"
        );
        // Non-loopback peer: the header is ignored entirely.
        assert_eq!(
            trust_proxy_client_ip("8.8.8.8", Some("127.0.0.1")),
            "8.8.8.8"
        );
        // All hops loopback: the effective client is loopback.
        assert_eq!(
            trust_proxy_client_ip("127.0.0.1", Some("::1, 127.0.0.1")),
            "127.0.0.1"
        );
        // Loopback peer, no header: the peer itself.
        assert_eq!(trust_proxy_client_ip("127.0.0.1", None), "127.0.0.1");
    }
}
