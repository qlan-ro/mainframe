//! How many bytes of history the target session can take. One UTF-8 byte is
//! counted as one token, which overestimates and so errs on the safe side.

/// The default handoff cap, in tokens.
pub const HANDOFF_TOKEN_CAP: u64 = 16_000;
pub const HANDOFF_BYTE_CAP: u64 = 64_000;
/// The window assumed when neither the catalog nor the session reports one.
pub const UNKNOWN_WINDOW: u64 = 128_000;
pub const IMAGE_ALLOWANCE: u64 = 8_192;
pub const FILE_ALLOWANCE: u64 = 4_096;
pub const MIN_RESERVE: u64 = 16_000;
/// Below this, a delta into a returning session is not worth sending: the
/// switch falls back to a fresh native session with a full handoff.
pub const MIN_DELTA_BUDGET: u64 = 2_048;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct BudgetInput {
    /// The target model's catalog context window.
    pub model_window: Option<u64>,
    /// The target native session's last reported window.
    pub native_max: Option<u64>,
    /// How much of that window the native session already uses.
    pub native_used: u64,
    /// The outgoing text before the handoff (attachment prefix + content).
    pub user_text_bytes: u64,
    pub images: u64,
    pub files: u64,
}

pub fn handoff_budget(i: &BudgetInput) -> u64 {
    let window = i
        .model_window
        .or(i.native_max)
        .unwrap_or(UNKNOWN_WINDOW)
        .min(i.native_max.unwrap_or(u64::MAX));
    let current = i.user_text_bytes + IMAGE_ALLOWANCE * i.images + FILE_ALLOWANCE * i.files;
    let reserve = MIN_RESERVE.max(window.div_ceil(4));
    let room = window.saturating_sub(i.native_used + current + reserve);
    HANDOFF_TOKEN_CAP.min(HANDOFF_BYTE_CAP).min(room)
}

/// A native session's current occupancy: its last reported total, else its
/// last per-turn input, else a quarter of its composed text's bytes.
pub fn native_used(
    last_total: Option<u64>,
    last_input: Option<i64>,
    composed_text_bytes: u64,
) -> u64 {
    last_total
        .or_else(|| last_input.filter(|v| *v > 0).map(|v| v as u64))
        .unwrap_or(composed_text_bytes / 4)
}
