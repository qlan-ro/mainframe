//! A process-wide cap on parse workers, shared by every history load.

use std::sync::atomic::{AtomicUsize, Ordering};

#[derive(Debug)]
pub(super) struct Budget {
    free: AtomicUsize,
    #[cfg(test)]
    lowest: AtomicUsize,
}

/// Workers taken from a [`Budget`]; returned when dropped, including on
/// error and panic.
pub(super) struct Permit<'a> {
    budget: &'a Budget,
    workers: usize,
}

impl Budget {
    pub(super) const fn new(workers: usize) -> Self {
        Self {
            free: AtomicUsize::new(workers),
            #[cfg(test)]
            lowest: AtomicUsize::new(workers),
        }
    }

    /// Takes up to `want` workers, as many as are free (possibly none).
    pub(super) fn take(&self, want: usize) -> Permit<'_> {
        let mut free = self.free.load(Ordering::Relaxed);
        loop {
            let workers = free.min(want);
            match self.free.compare_exchange_weak(
                free,
                free - workers,
                Ordering::AcqRel,
                Ordering::Relaxed,
            ) {
                Ok(_) => {
                    #[cfg(test)]
                    self.lowest.fetch_min(free - workers, Ordering::Relaxed);
                    return Permit {
                        budget: self,
                        workers,
                    };
                }
                Err(now) => free = now,
            }
        }
    }

    #[cfg(test)]
    pub(super) fn free(&self) -> usize {
        self.free.load(Ordering::Acquire)
    }

    /// The most workers ever held at once.
    #[cfg(test)]
    pub(super) fn peak(&self, capacity: usize) -> usize {
        capacity - self.lowest.load(Ordering::Relaxed)
    }
}

impl Permit<'_> {
    pub(super) fn workers(&self) -> usize {
        self.workers
    }
}

impl Drop for Permit<'_> {
    fn drop(&mut self) {
        self.budget.free.fetch_add(self.workers, Ordering::AcqRel);
    }
}

/// The budget shared by all loads: about one worker per core.
pub(super) fn global() -> &'static Budget {
    static GLOBAL: std::sync::OnceLock<Budget> = std::sync::OnceLock::new();
    GLOBAL.get_or_init(|| Budget::new(std::thread::available_parallelism().map_or(1, usize::from)))
}
