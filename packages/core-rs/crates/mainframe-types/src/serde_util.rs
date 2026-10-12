use serde::{Deserialize, Deserializer};

/// Distinguishes a missing field from an explicit JSON null with `#[serde(default)]`.
pub fn double_option<'de, D, T>(deserializer: D) -> Result<Option<Option<T>>, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de>,
{
    Deserialize::deserialize(deserializer).map(Some)
}

#[cfg(test)]
mod tests {
    use serde::Deserialize;

    #[derive(Debug, Deserialize, PartialEq)]
    struct Patch {
        #[serde(default, deserialize_with = "super::double_option")]
        value: Option<Option<String>>,
    }

    #[test]
    fn missing_null_and_value_are_distinct() {
        assert_eq!(serde_json::from_str::<Patch>("{}").unwrap().value, None);
        assert_eq!(
            serde_json::from_str::<Patch>(r#"{"value":null}"#)
                .unwrap()
                .value,
            Some(None)
        );
        assert_eq!(
            serde_json::from_str::<Patch>(r#"{"value":"x"}"#)
                .unwrap()
                .value,
            Some(Some("x".into()))
        );
    }
}
