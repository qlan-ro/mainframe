//! Device-token minting and validation.

pub mod token;
pub mod validate_authed_token;

pub use token::{TokenPayload, generate_pairing_code, generate_token};
pub use validate_authed_token::{DeviceLookup, validate_authed_token};
