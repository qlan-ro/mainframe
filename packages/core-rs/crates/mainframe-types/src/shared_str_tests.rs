use super::SharedStr;
use std::hash::{DefaultHasher, Hash, Hasher};

#[test]
fn serializes_and_deserializes_exactly_like_string() {
    for text in ["", "aGk=", "with \"quotes\" and \\ escapes\n", "ünïcødé ✓"] {
        let shared = SharedStr::from(text);
        assert_eq!(
            serde_json::to_string(&shared).unwrap(),
            serde_json::to_string(text).unwrap()
        );
        let json = serde_json::to_string(text).unwrap();
        let back: SharedStr = serde_json::from_str(&json).unwrap();
        assert_eq!(back, text);
        let from_value: SharedStr = serde_json::from_value(serde_json::json!(text)).unwrap();
        assert_eq!(from_value, text);
    }
}

#[test]
fn deserializes_inside_untagged_and_internally_tagged_enums() {
    #[derive(serde::Deserialize, PartialEq, Debug)]
    #[serde(tag = "type")]
    enum Tagged {
        Image { data: SharedStr },
    }
    #[derive(serde::Deserialize, PartialEq, Debug)]
    #[serde(untagged)]
    enum Untagged {
        Tagged(Tagged),
    }
    let parsed: Untagged = serde_json::from_str(r#"{"type":"Image","data":"QUJD"}"#).unwrap();
    assert_eq!(
        parsed,
        Untagged::Tagged(Tagged::Image {
            data: SharedStr::from("QUJD")
        })
    );
}

#[test]
fn clones_share_one_allocation() {
    let original = SharedStr::from("A".repeat(1 << 20));
    let copies: Vec<SharedStr> = (0..3).map(|_| original.clone()).collect();
    assert_eq!(original.strong_count(), 4);
    assert!(copies.iter().all(|copy| copy.ptr_eq(&original)));
    assert!(std::ptr::eq(copies[0].as_ptr(), original.as_ptr()));
    drop(copies);
    assert_eq!(original.strong_count(), 1);
}

#[test]
fn equality_and_hash_follow_the_content() {
    let a = SharedStr::from("same");
    let b = SharedStr::from(String::from("same"));
    assert!(!a.ptr_eq(&b));
    assert_eq!(a, b);
    assert_ne!(a, SharedStr::from("other"));
    assert_eq!(a, "same");
    assert_eq!(a, String::from("same"));

    let hash = |value: &dyn Fn(&mut DefaultHasher)| {
        let mut hasher = DefaultHasher::new();
        value(&mut hasher);
        hasher.finish()
    };
    assert_eq!(
        hash(&|h| a.hash(h)),
        hash(&|h| String::from("same").hash(h))
    );
}

#[test]
fn debug_and_display_match_the_string() {
    let shared = SharedStr::from("a\"b");
    assert_eq!(format!("{shared:?}"), format!("{:?}", "a\"b"));
    assert_eq!(shared.to_string(), "a\"b");
    assert_eq!(SharedStr::default(), "");
    assert!(SharedStr::default().is_empty());
}
