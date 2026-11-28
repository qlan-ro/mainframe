//! `SharedStr`: an immutable, reference-counted string for large payloads
//! that the daemon holds in several places at once — today the base64 `data`
//! of image blocks.
//!
//! One chat's history lives in the raw message cache, the display projection,
//! and the facade's revision log at the same time, and each is built by
//! cloning from the one before. With a plain `String` every clone copied the
//! whole payload, so an image sat in memory once per copy. A `SharedStr`
//! clone only bumps a count, so the bytes the parser allocated are the only
//! copy for as long as any of those structures holds the block.
//!
//! It serializes and deserializes exactly like `String` (a JSON string), so
//! the wire format, the history caches on disk and every client are
//! unaffected. Equality and hashing are by content, like `String`; equality
//! checks the pointer first, so comparing two clones of one payload is `O(1)`.

use std::borrow::Borrow;
use std::fmt;
use std::hash::{Hash, Hasher};
use std::ops::Deref;
use std::sync::Arc;

use serde::de::{self, Deserialize, Deserializer, Visitor};
use serde::ser::{Serialize, Serializer};

#[derive(Clone)]
pub struct SharedStr(Arc<str>);

impl SharedStr {
    pub fn as_str(&self) -> &str {
        &self.0
    }

    /// Whether `self` and `other` are clones of one allocation.
    pub fn ptr_eq(&self, other: &Self) -> bool {
        Arc::ptr_eq(&self.0, &other.0)
    }

    /// How many live handles share this payload.
    pub fn strong_count(&self) -> usize {
        Arc::strong_count(&self.0)
    }
}

impl Default for SharedStr {
    fn default() -> Self {
        Self(Arc::from(""))
    }
}

impl Deref for SharedStr {
    type Target = str;
    fn deref(&self) -> &str {
        &self.0
    }
}

impl AsRef<str> for SharedStr {
    fn as_ref(&self) -> &str {
        &self.0
    }
}

impl Borrow<str> for SharedStr {
    fn borrow(&self) -> &str {
        &self.0
    }
}

impl From<&str> for SharedStr {
    fn from(value: &str) -> Self {
        Self(Arc::from(value))
    }
}

impl From<String> for SharedStr {
    fn from(value: String) -> Self {
        Self(Arc::from(value))
    }
}

impl From<&String> for SharedStr {
    fn from(value: &String) -> Self {
        Self(Arc::from(value.as_str()))
    }
}

impl From<Arc<str>> for SharedStr {
    fn from(value: Arc<str>) -> Self {
        Self(value)
    }
}

impl From<SharedStr> for String {
    fn from(value: SharedStr) -> Self {
        value.0.as_ref().to_owned()
    }
}

impl PartialEq for SharedStr {
    fn eq(&self, other: &Self) -> bool {
        self.ptr_eq(other) || *self.0 == *other.0
    }
}

impl Eq for SharedStr {}

impl PartialEq<str> for SharedStr {
    fn eq(&self, other: &str) -> bool {
        &*self.0 == other
    }
}

impl PartialEq<&str> for SharedStr {
    fn eq(&self, other: &&str) -> bool {
        &*self.0 == *other
    }
}

impl PartialEq<String> for SharedStr {
    fn eq(&self, other: &String) -> bool {
        *self.0 == **other
    }
}

impl PartialOrd for SharedStr {
    fn partial_cmp(&self, other: &Self) -> Option<std::cmp::Ordering> {
        Some(self.cmp(other))
    }
}

impl Ord for SharedStr {
    fn cmp(&self, other: &Self) -> std::cmp::Ordering {
        self.0.cmp(&other.0)
    }
}

/// Hashes exactly as the equivalent `str`/`String` does, so a hash computed
/// over the payload (for example a cache-busting image version) is unchanged.
impl Hash for SharedStr {
    fn hash<H: Hasher>(&self, state: &mut H) {
        (*self.0).hash(state);
    }
}

impl fmt::Debug for SharedStr {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        fmt::Debug::fmt(&*self.0, f)
    }
}

impl fmt::Display for SharedStr {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        fmt::Display::fmt(&*self.0, f)
    }
}

impl Serialize for SharedStr {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.0)
    }
}

impl<'de> Deserialize<'de> for SharedStr {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        struct SharedStrVisitor;

        impl Visitor<'_> for SharedStrVisitor {
            type Value = SharedStr;

            fn expecting(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                f.write_str("a string")
            }

            // A borrowed or transient `&str` is copied straight into the
            // shared allocation, with no intermediate `String`.
            fn visit_str<E: de::Error>(self, value: &str) -> Result<SharedStr, E> {
                Ok(SharedStr::from(value))
            }

            fn visit_string<E: de::Error>(self, value: String) -> Result<SharedStr, E> {
                Ok(SharedStr::from(value))
            }

            fn visit_bytes<E: de::Error>(self, value: &[u8]) -> Result<SharedStr, E> {
                std::str::from_utf8(value)
                    .map(SharedStr::from)
                    .map_err(|_| E::invalid_value(de::Unexpected::Bytes(value), &self))
            }
        }

        deserializer.deserialize_string(SharedStrVisitor)
    }
}

#[cfg(test)]
#[path = "shared_str_tests.rs"]
mod tests;
