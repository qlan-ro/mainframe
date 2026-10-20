use serde::{Deserialize, Serialize};

/// `_mainframe.dev/replay_complete`'s params: closes exactly one
/// `session/resume` replay. Sent after `queue_state` and
/// before the buffered catch-up, in every arm that sent a successful reply.
/// `aborted` is present and `true` only when a resume delivery failed after
/// its reply went out; a normal close carries no `aborted` key at all, so a
/// client can tell "discard the staged replay" apart from "publish it" by
/// key presence, not by a `false` value that never ships.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplayCompleteParams {
    pub session_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub aborted: Option<bool>,
}

/// The one `encoding` [`ReplayBatchParams`] ships today: `data` is the
/// standard base64 of a zlib-deflated JSON array of `SessionUpdate`s.
pub const REPLAY_BATCH_ENCODING: &str = "deflate+base64";

/// `_mainframe.dev/replay_batch`'s params: one slice of a
/// `session/resume` replay for a connection that opted in with
/// [`super::COMPRESSED_REPLAY_OPT_IN_KEY`]. `count` is the number of `session/update`
/// payloads inside `data`, in replay order; batches for one reply arrive in
/// order and all precede the reply's gate, `queue_state` and
/// `replay_complete`. A client that cannot decode `encoding` must treat the
/// replay as failed, never apply a partial batch.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplayBatchParams {
    pub session_id: String,
    pub encoding: String,
    pub count: usize,
    pub data: String,
}
