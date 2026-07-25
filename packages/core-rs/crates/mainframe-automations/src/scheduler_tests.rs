//! T8.1 — pure schedule computation: SchedulePattern → cron (local time),
//! next occurrence and latest-at-or-before across day and DST edges. Tests
//! pin a named tz (America/New_York; DST 2026: Mar 8 spring-forward, Nov 1
//! fall-back) because prod runs in the machine's local tz.

use chrono::{DateTime, Datelike, TimeZone, Timelike};
use chrono_tz::America::New_York;
use chrono_tz::Tz;

use crate::domain::{
    DailySchedule, EveryNHoursSchedule, OnceSchedule, SchedulePattern, WeekdaysSchedule,
    WeeklySchedule,
};
use crate::scheduler::{
    compile_schedule, latest_occurrence_at_or_before, next_occurrence, scheduled_for_string,
};

fn daily(at: &str) -> SchedulePattern {
    SchedulePattern::Daily(DailySchedule { at: at.to_string() })
}

fn weekdays(at: &str) -> SchedulePattern {
    SchedulePattern::Weekdays(WeekdaysSchedule { at: at.to_string() })
}

fn weekly(days: Vec<u8>, at: &str) -> SchedulePattern {
    SchedulePattern::Weekly(WeeklySchedule {
        days,
        at: at.to_string(),
    })
}

fn every(n: u32) -> SchedulePattern {
    SchedulePattern::EveryNHours(EveryNHoursSchedule { n })
}

fn once(at: &str) -> SchedulePattern {
    SchedulePattern::Once(OnceSchedule { at: at.to_string() })
}

fn ny(y: i32, m: u32, d: u32, h: u32, min: u32) -> DateTime<Tz> {
    New_York
        .with_ymd_and_hms(y, m, d, h, min, 0)
        .single()
        .unwrap()
}

#[test]
fn compiles_patterns_to_local_cron_expressions() {
    assert_eq!(compile_schedule(&daily("21:00")).unwrap(), "0 21 * * *");
    assert_eq!(
        compile_schedule(&weekdays("06:30")).unwrap(),
        "30 6 * * 1-5"
    );
    assert_eq!(
        compile_schedule(&weekly(vec![1, 3], "09:15")).unwrap(),
        "15 9 * * 1,3"
    );
    assert_eq!(compile_schedule(&every(6)).unwrap(), "0 */6 * * *");
}

#[test]
fn every_n_hours_must_evenly_divide_24() {
    let err = compile_schedule(&every(5)).unwrap_err();
    assert_eq!(
        err.to_string(),
        "every_n_hours 'n' (5) must evenly divide 24"
    );
    assert!(compile_schedule(&every(0)).is_err());
    for n in [1, 2, 3, 4, 6, 8, 12, 24] {
        assert!(compile_schedule(&every(n)).is_ok(), "n={n} is a divisor");
    }
}

#[test]
fn malformed_at_times_are_errors_not_panics() {
    for bad in ["25:00", "07:61", "seven", "", "7", "07:0x"] {
        assert!(
            compile_schedule(&daily(bad)).is_err(),
            "'{bad}' should be rejected"
        );
    }
}

#[test]
fn daily_next_occurrence_crosses_the_spring_forward_edge_on_wall_clock() {
    // 2026-03-08 02:00 EST → 03:00 EDT. A 21:00 daily stays at 21:00 local
    // on both sides; the real elapsed gap between the two fires is 23h.
    let before = ny(2026, 3, 7, 21, 0);
    let next = next_occurrence(&daily("21:00"), &before)
        .unwrap()
        .expect("a repeating pattern always has a next slot");
    assert_eq!(next, ny(2026, 3, 8, 21, 0));
    assert_eq!(next.hour(), 21);
    let elapsed = next.signed_duration_since(before);
    assert_eq!(elapsed.num_hours(), 23, "spring-forward day is 23h long");
}

#[test]
fn daily_in_the_spring_forward_gap_snaps_to_the_first_valid_time() {
    // 02:30 does not exist on 2026-03-08 in New York; croner's fixed-time
    // DST policy snaps the fire to the first valid instant after the gap.
    let next = next_occurrence(&daily("02:30"), &ny(2026, 3, 7, 5, 0))
        .unwrap()
        .expect("a repeating pattern always has a next slot");
    assert_eq!(next.month(), 3);
    assert_eq!(next.day(), 8);
    assert_eq!(next.hour(), 3, "gap time snaps forward to 03:00 EDT");
}

#[test]
fn daily_next_occurrence_crosses_the_fall_back_edge_on_wall_clock() {
    // 2026-11-01 02:00 EDT → 01:00 EST: the day is 25h long.
    let before = ny(2026, 10, 31, 21, 0);
    let next = next_occurrence(&daily("21:00"), &before)
        .unwrap()
        .expect("a repeating pattern always has a next slot");
    assert_eq!(next.hour(), 21);
    assert_eq!(next.day(), 1);
    assert_eq!(
        next.signed_duration_since(before).num_hours(),
        25,
        "fall-back day is 25h long"
    );
}

#[test]
fn weekdays_skip_the_weekend() {
    // 2026-07-10 is a Friday.
    let next = next_occurrence(&weekdays("06:00"), &ny(2026, 7, 10, 7, 0))
        .unwrap()
        .expect("a repeating pattern always has a next slot");
    assert_eq!(next, ny(2026, 7, 13, 6, 0), "Friday 07:00 → Monday 06:00");
}

#[test]
fn weekly_fires_on_the_listed_days_only() {
    // 2026-07-08 is a Wednesday (weekday 3).
    let next = next_occurrence(&weekly(vec![3], "09:30"), &ny(2026, 7, 8, 10, 0))
        .unwrap()
        .expect("a repeating pattern always has a next slot");
    assert_eq!(next, ny(2026, 7, 15, 9, 30));
}

#[test]
fn every_n_hours_crosses_the_day_edge() {
    let next = next_occurrence(&every(6), &ny(2026, 7, 12, 19, 0))
        .unwrap()
        .expect("a repeating pattern always has a next slot");
    assert_eq!(next, ny(2026, 7, 13, 0, 0), "18:00 + 6h slot → midnight");
}

#[test]
fn every_n_hours_across_fall_back_stays_on_slot_times() {
    let next = next_occurrence(&every(6), &ny(2026, 11, 1, 0, 30))
        .unwrap()
        .expect("a repeating pattern always has a next slot");
    assert_eq!(next.day(), 1);
    assert_eq!(next.hour(), 6, "next slot after 00:30 is 06:00 local");
    // The 25h day means 00:30 EDT → 06:00 EST is 6.5 real hours.
    let elapsed = next.signed_duration_since(ny(2026, 11, 1, 0, 30));
    assert_eq!(elapsed.num_minutes(), 390);
}

#[test]
fn latest_occurrence_at_or_before_walks_backwards() {
    let latest = latest_occurrence_at_or_before(&daily("21:00"), &ny(2026, 7, 12, 10, 0))
        .unwrap()
        .unwrap();
    assert_eq!(latest, ny(2026, 7, 11, 21, 0));

    // Exactly on the slot is inclusive.
    let latest = latest_occurrence_at_or_before(&daily("21:00"), &ny(2026, 7, 12, 21, 0))
        .unwrap()
        .unwrap();
    assert_eq!(latest, ny(2026, 7, 12, 21, 0));

    // 2026-07-12 is a Sunday: the latest weekdays-06:00 slot is Friday's.
    let latest = latest_occurrence_at_or_before(&weekdays("06:00"), &ny(2026, 7, 12, 12, 0))
        .unwrap()
        .unwrap();
    assert_eq!(latest, ny(2026, 7, 10, 6, 0));
}

#[test]
fn once_offers_one_frozen_slot_from_its_instant_onwards() {
    let at = "2026-08-14T09:00";
    assert!(
        latest_occurrence_at_or_before(&once(at), &ny(2026, 8, 14, 8, 59))
            .unwrap()
            .is_none(),
        "nothing to offer before the instant"
    );
    let on_time = latest_occurrence_at_or_before(&once(at), &ny(2026, 8, 14, 9, 0))
        .unwrap()
        .unwrap();
    let much_later = latest_occurrence_at_or_before(&once(at), &ny(2026, 9, 1, 0, 0))
        .unwrap()
        .unwrap();
    assert_eq!(on_time, ny(2026, 8, 14, 9, 0));
    assert_eq!(much_later, on_time, "the slot never moves");
    // Every later sweep derives the same dedup key, so the run row rejects the re-offer.
    assert_eq!(scheduled_for_string(&much_later), "2026-08-14T09:00:00");
}

#[test]
fn once_has_no_next_occurrence_once_it_has_passed() {
    let at = "2026-08-14T09:00";
    assert_eq!(
        next_occurrence(&once(at), &ny(2026, 8, 1, 0, 0)).unwrap(),
        Some(ny(2026, 8, 14, 9, 0))
    );
    assert_eq!(
        next_occurrence(&once(at), &ny(2026, 8, 14, 9, 0)).unwrap(),
        None
    );
}

#[test]
fn once_in_the_spring_forward_gap_snaps_like_the_repeating_patterns() {
    let latest = latest_occurrence_at_or_before(&once("2026-03-08T02:30"), &ny(2026, 3, 9, 0, 0))
        .unwrap()
        .unwrap();
    assert_eq!(latest.hour(), 3, "gap time snaps forward to 03:00 EDT");
    assert_eq!(latest.minute(), 0);
}

#[test]
fn once_has_no_cron_form_and_rejects_malformed_timestamps() {
    assert!(compile_schedule(&once("2026-08-14T09:00")).is_err());
    for bad in [
        "2026-08-14",
        "2026-08-14 09:00",
        "not-a-time",
        "",
        "2026-13-01T09:00",
    ] {
        assert!(
            latest_occurrence_at_or_before(&once(bad), &ny(2026, 8, 14, 9, 0)).is_err(),
            "'{bad}' should be rejected"
        );
    }
}

#[test]
fn scheduled_for_uses_the_naive_local_form() {
    // Node's toLocalIso: `YYYY-MM-DDTHH:mm:ss`, no timezone suffix — the
    // dedup key `<triggerId>|<scheduledFor>` must match across engines.
    assert_eq!(
        scheduled_for_string(&ny(2026, 7, 12, 21, 0)),
        "2026-07-12T21:00:00"
    );
    assert_eq!(
        scheduled_for_string(&ny(2026, 1, 2, 3, 4)),
        "2026-01-02T03:04:00"
    );
}
