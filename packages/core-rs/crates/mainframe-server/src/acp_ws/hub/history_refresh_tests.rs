use super::*;

#[test]
fn a_turn_soon_after_a_refresh_waits_out_the_interval() {
    let now = Instant::now();
    assert_eq!(refresh_delay(None, now), REFRESH_DELAY);
    let recent = Some(now - MIN_REFRESH_INTERVAL / 4);
    assert_eq!(
        refresh_delay(recent, now),
        MIN_REFRESH_INTERVAL - MIN_REFRESH_INTERVAL / 4
    );
    let old = Some(now - MIN_REFRESH_INTERVAL * 2);
    assert_eq!(refresh_delay(old, now), REFRESH_DELAY);
}
