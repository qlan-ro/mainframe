#![forbid(unsafe_code)]
#![cfg_attr(test, allow(clippy::unwrap_used, clippy::expect_used))]

mod adapter;
mod dispatch;
mod fixture;
mod history;
mod session;
mod session_trait;

pub mod skills;

pub use adapter::{MockCliAdapter, sanitize_key};
pub use fixture::{RecordedEvent, parse_fixture};
pub use session::ReplaySession;
