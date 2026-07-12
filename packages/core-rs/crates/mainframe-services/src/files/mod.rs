//! Ported from `src/files/*`.

pub mod file_watcher;

pub use file_watcher::FileWatcherService;

// PORT STATUS: src/files/ (module barrel; only file-watcher.ts is under it)
// confidence: high
// todos: 0
