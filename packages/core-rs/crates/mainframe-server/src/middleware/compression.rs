//! Negotiated response compression for the HTTP API (todo #294).
//!
//! Scoped to the HTTP router in `http.rs`, never the WS upgrade routes.

use tower_http::compression::predicate::{And, NotForContentType, Predicate, SizeAbove};
use tower_http::compression::{CompressionLayer, CompressionLevel};

/// Below this, the compressor costs more than the bytes it saves — `/health`
/// and the small config/state envelopes stay raw.
const MIN_COMPRESS_BYTES: u16 = 1024;

/// Brotli's own default is quality 11, an order of magnitude slower than gzip;
/// tower-http applies one quality to every encoding, so pin a fast level that
/// suits both.
const COMPRESSION_QUALITY: i32 = 4;

/// `DefaultPredicate` with a larger floor — it takes no configuration, so the
/// same three content-type exclusions are recomposed here by hand.
type ApiCompressionPredicate =
    And<And<And<SizeAbove, NotForContentType>, NotForContentType>, NotForContentType>;

fn api_compression_predicate() -> ApiCompressionPredicate {
    SizeAbove::new(MIN_COMPRESS_BYTES)
        .and(NotForContentType::GRPC)
        .and(NotForContentType::IMAGES)
        .and(NotForContentType::SSE)
}

/// gzip + brotli, chosen by the client's `Accept-Encoding` preference.
pub fn compression_layer() -> CompressionLayer<ApiCompressionPredicate> {
    CompressionLayer::new()
        .gzip(true)
        .br(true)
        .quality(CompressionLevel::Precise(COMPRESSION_QUALITY))
        .compress_when(api_compression_predicate())
}
