use std::mem::{size_of_val, MaybeUninit};
use sysinfo::Pid;

pub(super) fn footprint(pid: Pid) -> Option<u64> {
    let pid = libc::pid_t::try_from(pid.as_u32()).ok()?;
    let mut usage = MaybeUninit::<libc::rusage_info_v2>::uninit();
    // SAFETY: libproc fills a complete v2 record on success.
    unsafe {
        (libc::proc_pid_rusage(pid, libc::RUSAGE_INFO_V2, usage.as_mut_ptr().cast()) == 0)
            .then(|| usage.assume_init().ri_phys_footprint)
    }
}

pub(super) fn coalition(pid: Pid) -> Option<u64> {
    let pid = libc::pid_t::try_from(pid.as_u32()).ok()?;
    // XNU proc_pidcoalitioninfo: two coalition IDs and three reserved uint64_t fields.
    const PROC_PIDCOALITIONINFO: libc::c_int = 20;
    let mut info = [0u64; 5];
    let size = libc::c_int::try_from(size_of_val(&info)).ok()?;
    // SAFETY: the kernel receives a writable buffer with its exact length.
    let written = unsafe {
        libc::proc_pidinfo(
            pid,
            PROC_PIDCOALITIONINFO,
            0,
            info.as_mut_ptr().cast(),
            size,
        )
    };
    (written == size && info[0] != 0).then_some(info[0])
}
