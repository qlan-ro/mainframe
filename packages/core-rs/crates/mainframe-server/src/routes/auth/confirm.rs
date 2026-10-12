use super::*;

pub(super) fn consume_pairing(parsed: &ConfirmBody, ip: &str) -> ConfirmOutcome {
    let mut state = AUTH_STATE.lock_recover();
    if is_rate_limited(&mut state, ip) {
        return ConfirmOutcome::Reject(fail(
            StatusCode::TOO_MANY_REQUESTS,
            "Too many attempts, try again later",
        ));
    }
    clean_expired_pairings(&mut state);

    match state.pending.get_mut(&parsed.pairing_code) {
        None => {
            record_failure(&mut state, ip);
            ConfirmOutcome::Reject(fail(
                StatusCode::UNAUTHORIZED,
                "Invalid or expired pairing code",
            ))
        }
        Some(pairing) if now_ms() - pairing.created_at > PAIRING_EXPIRY_MS => {
            state.pending.remove(&parsed.pairing_code);
            record_failure(&mut state, ip);
            ConfirmOutcome::Reject(fail(
                StatusCode::UNAUTHORIZED,
                "Invalid or expired pairing code",
            ))
        }
        Some(pairing) => {
            pairing.failed_attempts += 1;
            if pairing.failed_attempts > MAX_PAIRING_ATTEMPTS {
                state.pending.remove(&parsed.pairing_code);
                record_failure(&mut state, ip);
                ConfirmOutcome::Reject(fail(
                    StatusCode::UNAUTHORIZED,
                    "Too many failed attempts, pairing code invalidated",
                ))
            } else {
                let default_name = pairing.device_name.clone();
                state.pending.remove(&parsed.pairing_code);
                let device_id = format!("mobile-{}", parsed.client_device_id);
                let name = parsed.device_name.clone().unwrap_or(default_name);
                ConfirmOutcome::Proceed { device_id, name }
            }
        }
    }
}

pub(super) fn validate_confirm_body(body: &[u8], ip: &str) -> Result<ConfirmBody, Box<Response>> {
    let Some(parsed): Option<ConfirmBody> = parse_body(body) else {
        // Rate limit is checked before body parse in the TS; mirror that order.
        let mut state = AUTH_STATE.lock_recover();
        if is_rate_limited(&mut state, ip) {
            return Err(Box::new(fail(
                StatusCode::TOO_MANY_REQUESTS,
                "Too many attempts, try again later",
            )));
        }
        return Err(Box::new(fail(
            StatusCode::BAD_REQUEST,
            "Invalid request body",
        )));
    };
    // The confirm body needs a non-empty pairingCode, an optional non-empty
    // deviceName and a UUID clientDeviceId. serde alone accepts an empty
    // pairingCode or an empty-but-present deviceName — fold those into the same
    // rate-limit-then-400 path so an invalid body never pairs.
    if parsed.pairing_code.is_empty()
        || parsed.device_name.as_deref() == Some("")
        || !is_valid_uuid(&parsed.client_device_id)
    {
        let mut state = AUTH_STATE.lock_recover();
        if is_rate_limited(&mut state, ip) {
            return Err(Box::new(fail(
                StatusCode::TOO_MANY_REQUESTS,
                "Too many attempts, try again later",
            )));
        }
        return Err(Box::new(fail(
            StatusCode::BAD_REQUEST,
            "Invalid request body",
        )));
    }

    Ok(parsed)
}
