use std::fs::File;
use std::path::Path;

use crate::spool_walker::SpoolTaskEntry;

pub(super) struct SweepOutput {
    pub probe_path: String,
    _file: File,
}

impl SweepOutput {
    #[cfg(any(target_os = "linux", target_os = "macos"))]
    pub fn open(root: &Path, entry: &SpoolTaskEntry) -> Option<Self> {
        use rustix::fs::{Mode, OFlags, openat};

        let mut dir = File::open(root.parent()?).ok()?;
        let dirs = [
            root.file_name()?,
            entry.cwd_seg.as_ref(),
            entry.sess.as_ref(),
            "tasks".as_ref(),
        ];
        let flags = OFlags::RDONLY | OFlags::NOFOLLOW | OFlags::CLOEXEC;
        for part in dirs {
            dir = openat(&dir, part, flags | OFlags::DIRECTORY, Mode::empty())
                .ok()?
                .into();
        }
        let name = format!("{}.output", entry.task_id);
        let file: File = openat(&dir, name, flags | OFlags::NONBLOCK, Mode::empty())
            .ok()?
            .into();
        let metadata = file.metadata().ok()?;
        if !metadata.is_file() {
            return None;
        }
        // lsof opens its argument again, so give it the pinned file's identity.
        #[cfg(target_os = "macos")]
        let probe_path = {
            use std::os::unix::fs::MetadataExt;
            format!("/.vol/{}/{}", metadata.dev(), metadata.ino())
        };
        #[cfg(target_os = "linux")]
        let probe_path = {
            use std::os::fd::AsRawFd;
            format!("/proc/{}/fd/{}", std::process::id(), file.as_raw_fd())
        };
        Some(Self {
            probe_path,
            _file: file,
        })
    }

    #[cfg(not(any(target_os = "linux", target_os = "macos")))]
    pub fn open(_root: &Path, _entry: &SpoolTaskEntry) -> Option<Self> {
        None
    }
}
