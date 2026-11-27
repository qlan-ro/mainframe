//! Parsed sub-agent transcripts kept between pages, lazy image fetches and
//! expands, bounded by the size of their files and by idle time.

use std::collections::VecDeque;
use std::path::Path;
use std::sync::{Arc, LazyLock, Mutex, Once};
use std::time::{Duration, Instant, SystemTime};

use mainframe_types::chat::ChatMessage;
use mainframe_types::sync::LockExt as _;

pub(super) type Messages = Arc<Vec<ChatMessage>>;

/// Holds the 25 MB child of the largest benchmarked session with room to
/// spare. A parsed child takes about 0.6–1.0x its file size in memory.
pub(super) const CACHE_BUDGET_BYTES: u64 = 32 * 1024 * 1024;
/// A child nobody has paged, expanded or fetched an image from for this long
/// is dropped.
const IDLE_EVICTION: Duration = Duration::from_secs(10 * 60);
const SWEEP_INTERVAL: Duration = Duration::from_secs(60);

static CACHE: LazyLock<Mutex<ChildCache>> =
    LazyLock::new(|| Mutex::new(ChildCache::new(CACHE_BUDGET_BYTES)));
static SWEEPER: Once = Once::new();

#[derive(PartialEq, Eq)]
pub(super) struct Stamp(pub(super) u64, pub(super) SystemTime);

impl Stamp {
    pub(super) fn read(path: &Path) -> std::io::Result<Self> {
        let metadata = std::fs::symlink_metadata(path)?;
        if !metadata.is_file() {
            return Err(std::io::ErrorKind::NotFound.into());
        }
        Ok(Self(metadata.len(), metadata.modified()?))
    }
}

pub(super) struct ChildEntry {
    pub(super) path: String,
    pub(super) stamp: Stamp,
    pub(super) messages: Messages,
}

pub(super) fn cached(path: &str, stamp: &Stamp) -> Option<Messages> {
    let entry = CACHE.lock_recover().get(path, stamp, Instant::now())?;
    Some(Arc::clone(&entry.messages))
}

pub(super) fn keep(entry: Arc<ChildEntry>) {
    CACHE.lock_recover().insert(entry, Instant::now());
    // A thread that wakes once a minute, so an idle child is dropped even when
    // no other sub-agent is opened after it.
    SWEEPER.call_once(|| {
        let spawned = std::thread::Builder::new()
            .name("subagent-cache-sweep".into())
            .spawn(|| {
                loop {
                    std::thread::sleep(SWEEP_INTERVAL);
                    CACHE.lock_recover().evict_idle(Instant::now());
                }
            });
        // Without it, idle children still go whenever the cache is next used.
        if let Err(error) = spawned {
            tracing::warn!(%error, "sub-agent cache sweeper did not start");
        }
    });
}

struct Cached {
    entry: Arc<ChildEntry>,
    used: Instant,
}

/// Most recently used first; evicts from the back once the files' bytes pass
/// the budget. The latest child larger than the whole budget is kept on its own
/// slot, so its pages, lazy images and expands don't parse it again each time.
pub(super) struct ChildCache {
    entries: VecDeque<Cached>,
    bytes: u64,
    budget: u64,
    oversized: Option<Cached>,
}

impl ChildCache {
    const fn new(budget: u64) -> Self {
        Self {
            entries: VecDeque::new(),
            bytes: 0,
            budget,
            oversized: None,
        }
    }

    fn take(&mut self, path: &str) -> Option<Arc<ChildEntry>> {
        if self
            .oversized
            .as_ref()
            .is_some_and(|cached| cached.entry.path == path)
        {
            return self.oversized.take().map(|cached| cached.entry);
        }
        let index = self
            .entries
            .iter()
            .position(|cached| cached.entry.path == path)?;
        let cached = self.entries.remove(index)?;
        self.bytes -= cached.entry.stamp.0;
        Some(cached.entry)
    }

    fn get(&mut self, path: &str, stamp: &Stamp, now: Instant) -> Option<Arc<ChildEntry>> {
        self.evict_idle(now);
        let entry = self.take(path).filter(|entry| &entry.stamp == stamp)?;
        self.insert(Arc::clone(&entry), now);
        Some(entry)
    }

    fn insert(&mut self, entry: Arc<ChildEntry>, now: Instant) {
        self.evict_idle(now);
        self.take(&entry.path);
        let cached = Cached { entry, used: now };
        if cached.entry.stamp.0 > self.budget {
            self.oversized = Some(cached);
            return;
        }
        self.bytes += cached.entry.stamp.0;
        self.entries.push_front(cached);
        while self.bytes > self.budget
            && let Some(evicted) = self.entries.pop_back()
        {
            self.bytes -= evicted.entry.stamp.0;
        }
    }

    fn evict_idle(&mut self, now: Instant) {
        let fresh = |cached: &Cached| now.saturating_duration_since(cached.used) < IDLE_EVICTION;
        self.oversized = self.oversized.take().filter(fresh);
        self.entries.retain(fresh);
        self.bytes = self.entries.iter().map(|cached| cached.entry.stamp.0).sum();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(path: &str, bytes: u64) -> Arc<ChildEntry> {
        Arc::new(ChildEntry {
            path: path.into(),
            stamp: Stamp(bytes, SystemTime::UNIX_EPOCH),
            messages: Arc::default(),
        })
    }

    fn stamp(bytes: u64) -> Stamp {
        Stamp(bytes, SystemTime::UNIX_EPOCH)
    }

    fn paths(cache: &ChildCache) -> Vec<&str> {
        cache
            .entries
            .iter()
            .map(|cached| cached.entry.path.as_str())
            .collect()
    }

    fn oversized(cache: &ChildCache) -> Option<&str> {
        cache
            .oversized
            .as_ref()
            .map(|cached| cached.entry.path.as_str())
    }

    #[test]
    fn child_cache_keeps_children_within_its_byte_budget() {
        let now = Instant::now();
        let mut cache = ChildCache::new(30);
        cache.insert(entry("a", 25), now);
        cache.insert(entry("b", 4), now);
        assert_eq!(paths(&cache), ["b", "a"]);
        assert!(cache.get("a", &stamp(25), now).is_some());
        cache.insert(entry("c", 3), now);
        assert_eq!(paths(&cache), ["c", "a"]);
        assert_eq!(cache.bytes, 28);
        assert!(cache.get("a", &stamp(26), now).is_none());
        assert_eq!(paths(&cache), ["c"]);
        assert_eq!(cache.bytes, 3);
    }

    #[test]
    fn child_cache_holds_the_benchmarks_largest_child_within_the_budget() {
        let now = Instant::now();
        let mut cache = ChildCache::new(CACHE_BUDGET_BYTES);
        cache.insert(entry("largest", 25 * 1024 * 1024), now);
        cache.insert(entry("next", 6 * 1024 * 1024), now);
        assert!(
            cache
                .get("largest", &stamp(25 * 1024 * 1024), now)
                .is_some()
        );
        assert_eq!(paths(&cache), ["largest", "next"]);
        assert!(oversized(&cache).is_none());
    }

    #[test]
    fn child_cache_keeps_only_the_latest_child_over_the_budget_beside_the_rest() {
        let now = Instant::now();
        let mut cache = ChildCache::new(30);
        cache.insert(entry("small", 10), now);
        cache.insert(entry("huge", 31), now);
        assert_eq!(paths(&cache), ["small"]);
        assert_eq!(cache.bytes, 10);
        // Every lazy image and expand of the huge child is served without a parse.
        assert!(cache.get("huge", &stamp(31), now).is_some());
        assert!(cache.get("huge", &stamp(31), now).is_some());
        cache.insert(entry("bigger", 40), now);
        assert_eq!(oversized(&cache), Some("bigger"));
        assert!(cache.get("huge", &stamp(31), now).is_none());
        assert_eq!(paths(&cache), ["small"]);
    }

    #[test]
    fn child_cache_drops_children_left_idle() {
        let start = Instant::now();
        let mut cache = ChildCache::new(30);
        cache.insert(entry("old", 10), start);
        cache.insert(entry("huge", 31), start);
        let later = start + IDLE_EVICTION - Duration::from_secs(1);
        cache.insert(entry("recent", 5), later);
        assert!(cache.get("old", &stamp(10), later).is_some());
        let idle = start + IDLE_EVICTION + Duration::from_secs(1);
        cache.evict_idle(idle);
        assert_eq!(paths(&cache), ["old", "recent"]);
        assert!(oversized(&cache).is_none());
        cache.evict_idle(later + IDLE_EVICTION);
        assert!(paths(&cache).is_empty());
        assert_eq!(cache.bytes, 0);
    }
}
