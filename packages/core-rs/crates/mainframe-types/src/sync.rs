use std::sync::{Mutex, MutexGuard};

/// Recovers the protected value after another thread panics while holding it.
pub trait LockExt<T: ?Sized> {
    fn lock_recover(&self) -> MutexGuard<'_, T>;
}

impl<T: ?Sized> LockExt<T> for Mutex<T> {
    fn lock_recover(&self) -> MutexGuard<'_, T> {
        self.lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }
}

pub trait RwLockExt<T: ?Sized> {
    fn read_recover(&self) -> std::sync::RwLockReadGuard<'_, T>;
    fn write_recover(&self) -> std::sync::RwLockWriteGuard<'_, T>;
}

impl<T: ?Sized> RwLockExt<T> for std::sync::RwLock<T> {
    fn read_recover(&self) -> std::sync::RwLockReadGuard<'_, T> {
        self.read()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }
    fn write_recover(&self) -> std::sync::RwLockWriteGuard<'_, T> {
        self.write()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    #[test]
    fn recovers_and_mutates_a_poisoned_value() {
        let value = Arc::new(Mutex::new(7));
        let other = value.clone();
        assert!(
            std::panic::catch_unwind(move || {
                let mut guard = other.lock().unwrap();
                *guard = 11;
                panic!("poison fixture");
            })
            .is_err()
        );
        assert!(value.is_poisoned());
        assert_eq!(*value.lock_recover(), 11);
        *value.lock_recover() = 13;
        assert_eq!(*value.lock_recover(), 13);
    }
    #[test]
    fn recovers_poisoned_read_and_write_guards() {
        let value = std::sync::RwLock::new(3);
        assert!(
            std::panic::catch_unwind(|| {
                let mut guard = value.write().unwrap();
                *guard = 5;
                panic!("poison fixture");
            })
            .is_err()
        );
        assert!(value.is_poisoned());
        assert_eq!(*value.read_recover(), 5);
        *value.write_recover() = 9;
        assert_eq!(*value.read_recover(), 9);
    }
}
