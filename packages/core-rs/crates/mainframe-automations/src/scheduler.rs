//! Pure schedule computation (T8.1, Node triggers/schedule.ts +
//! cron-parser). A plain-language `SchedulePattern` compiles to a cron
//! string evaluated in the caller's timezone (contract §1: all schedules
//! run in local time — cron never crosses the API); croner does the
//! occurrence math. The 30 s sweep (T8.2) lives in `triggers::sweep`.

use std::str::FromStr;

use chrono::{DateTime, NaiveDateTime, TimeDelta, TimeZone};
use croner::Cron;
use croner::errors::CronError;

use crate::domain::SchedulePattern;

#[derive(Debug, thiserror::Error)]
pub enum ScheduleError {
    /// `0 */n * * *` resets at midnight, so a non-divisor n would fire at
    /// uneven gaps — the picker offers only divisors and this defends any
    /// caller that bypasses schema validation (Node compileSchedule parity).
    #[error("every_n_hours 'n' ({0}) must evenly divide 24")]
    NotADivisorOf24(u32),

    #[error("schedule time '{0}' is not a valid HH:MM")]
    InvalidTime(String),

    #[error("schedule timestamp '{0}' is not a valid local YYYY-MM-DDTHH:MM")]
    InvalidTimestamp(String),

    /// `once` fires at one instant, which no repeating cron string expresses.
    #[error("a 'once' schedule has no cron form")]
    OnceHasNoCronForm,

    #[error("schedule cron error: {0}")]
    Cron(#[from] CronError),
}

/// SchedulePattern → 5-field cron string (Node triggers/schedule.ts).
pub fn compile_schedule(pattern: &SchedulePattern) -> Result<String, ScheduleError> {
    match pattern {
        SchedulePattern::Daily(daily) => daily_cron(&daily.at, "*"),
        SchedulePattern::Weekdays(weekdays) => daily_cron(&weekdays.at, "1-5"),
        SchedulePattern::Weekly(weekly) => {
            let days = weekly
                .days
                .iter()
                .map(u8::to_string)
                .collect::<Vec<_>>()
                .join(",");
            daily_cron(&weekly.at, &days)
        }
        SchedulePattern::EveryNHours(every) => {
            if every.n == 0 || 24 % every.n != 0 {
                return Err(ScheduleError::NotADivisorOf24(every.n));
            }
            Ok(format!("0 */{} * * *", every.n))
        }
        SchedulePattern::Once(_) => Err(ScheduleError::OnceHasNoCronForm),
    }
}

/// A `once` timestamp resolved in `tz`. Ambiguous fall-back times take the
/// earlier of the pair and spring-forward gaps snap to the first valid minute
/// after them, which is croner's policy for the repeating patterns.
fn once_instant<Tz: TimeZone>(at: &str, tz: &Tz) -> Result<DateTime<Tz>, ScheduleError> {
    let invalid = || ScheduleError::InvalidTimestamp(at.to_string());
    // The editor types minutes, but a `datetime-local` input may carry
    // seconds; refusing them would silently never fire the automation.
    let naive = NaiveDateTime::parse_from_str(at, "%Y-%m-%dT%H:%M:%S")
        .or_else(|_| NaiveDateTime::parse_from_str(at, "%Y-%m-%dT%H:%M"))
        .map_err(|_| invalid())?;
    (0..DST_GAP_SCAN_MINUTES)
        .find_map(|minute| {
            tz.from_local_datetime(&(naive + TimeDelta::minutes(minute)))
                .earliest()
        })
        .ok_or_else(invalid)
}

/// Long enough to cross any real DST gap (the widest is one hour).
const DST_GAP_SCAN_MINUTES: i64 = 180;

fn daily_cron(at: &str, weekday: &str) -> Result<String, ScheduleError> {
    let (hour, minute) = parse_at(at)?;
    Ok(format!("{minute} {hour} * * {weekday}"))
}

fn parse_at(at: &str) -> Result<(u32, u32), ScheduleError> {
    let invalid = || ScheduleError::InvalidTime(at.to_string());
    let (hour, minute) = at.split_once(':').ok_or_else(invalid)?;
    let hour: u32 = hour.parse().map_err(|_| invalid())?;
    let minute: u32 = minute.parse().map_err(|_| invalid())?;
    if hour > 23 || minute > 59 {
        return Err(invalid());
    }
    Ok((hour, minute))
}

/// Strictly-next occurrence after `after`, in `after`'s timezone; `None`
/// once a `once` schedule has passed. Croner resolves DST edges: a fixed
/// time falling in a spring-forward gap snaps to the first valid instant
/// after it; a fall-back ambiguity fires at the earliest of the pair.
pub fn next_occurrence<Tz: TimeZone>(
    pattern: &SchedulePattern,
    after: &DateTime<Tz>,
) -> Result<Option<DateTime<Tz>>, ScheduleError> {
    if let SchedulePattern::Once(once) = pattern {
        let at = once_instant(&once.at, &after.timezone())?;
        return Ok((at > *after).then_some(at));
    }
    let cron = parse_cron(pattern)?;
    Ok(Some(cron.find_next_occurrence(after, false)?))
}

/// The latest occurrence at or before `now` — the sweep's derived-state
/// primitive (locked decision: no trigger_state table; each sweep recomputes
/// the current slot and lets the dedup index reject re-fires). `None` when
/// no occurrence exists within croner's backward search horizon (~1 year).
pub fn latest_occurrence_at_or_before<Tz: TimeZone>(
    pattern: &SchedulePattern,
    now: &DateTime<Tz>,
) -> Result<Option<DateTime<Tz>>, ScheduleError> {
    if let SchedulePattern::Once(once) = pattern {
        let at = once_instant(&once.at, &now.timezone())?;
        return Ok((at <= *now).then_some(at));
    }
    let cron = parse_cron(pattern)?;
    match cron.find_previous_occurrence(now, true) {
        Ok(occurrence) => Ok(Some(occurrence)),
        Err(CronError::TimeSearchLimitExceeded) => Ok(None),
        Err(err) => Err(err.into()),
    }
}

/// Naive local `YYYY-MM-DDTHH:mm:ss` (Node scheduler.ts toLocalIso) — feeds
/// `trigger.scheduledFor` and the dedup key `<triggerId>|<scheduledFor>`,
/// which must be byte-identical across engines sharing an automations.db.
pub fn scheduled_for_string<Tz: TimeZone>(occurrence: &DateTime<Tz>) -> String {
    occurrence
        .naive_local()
        .format("%Y-%m-%dT%H:%M:%S")
        .to_string()
}

fn parse_cron(pattern: &SchedulePattern) -> Result<Cron, ScheduleError> {
    Ok(Cron::from_str(&compile_schedule(pattern)?)?)
}

// PORT STATUS: greenfield (docs/plans/2026-07-12-automations-v2-rust-engine.md T8.1), not a TS port
// confidence: high
// todos: 0
// notes: mirrors Node triggers/schedule.ts compileSchedule + cron-parser
//        local-time evaluation; croner replaces cron-parser, and
//        find_previous_occurrence replaces Node's stored next_fire_at rows.
