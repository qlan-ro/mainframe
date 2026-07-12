//! Ported from `packages/core/src/plugins/config-context.ts`.
//!
//! A namespaced key/value view over the host settings store. Keys are prefixed
//! with `plugin:<pluginId>:`; the JSON encode/decode lives in the injected
//! getter/setter closures (as in `context.ts`), so this module only owns the
//! prefixing and the `keys` set that backs `getAll()`.

use std::sync::Mutex;

use serde_json::{Map, Value};

use crate::context::PluginConfig;

type Getter = Box<dyn Fn(&str) -> Option<Value> + Send + Sync>;
type Setter = Box<dyn Fn(&str, Value) + Send + Sync>;

pub struct PluginConfigImpl {
    prefix: String,
    keys: Mutex<Vec<String>>,
    get_setting: Getter,
    set_setting: Setter,
}

/// `createPluginConfig(pluginId, getSetting, setSetting)`.
pub fn create_plugin_config(
    plugin_id: &str,
    get_setting: Getter,
    set_setting: Setter,
) -> PluginConfigImpl {
    PluginConfigImpl {
        prefix: format!("plugin:{plugin_id}:"),
        keys: Mutex::new(Vec::new()),
        get_setting,
        set_setting,
    }
}

impl PluginConfig for PluginConfigImpl {
    fn get(&self, key: &str) -> Option<Value> {
        (self.get_setting)(&format!("{}{}", self.prefix, key))
    }

    fn set(&self, key: &str, value: Value) {
        if let Ok(mut keys) = self.keys.lock()
            && !keys.iter().any(|k| k == key)
        {
            keys.push(key.to_string());
        }
        (self.set_setting)(&format!("{}{}", self.prefix, key), value);
    }

    fn get_all(&self) -> Map<String, Value> {
        let keys = self.keys.lock().map(|k| k.clone()).unwrap_or_default();
        keys.into_iter()
            .map(|k| {
                let value = self.get(&k).unwrap_or(Value::Null);
                (k, value)
            })
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    #[test]
    fn prefixes_keys_and_tracks_getall() {
        let store: Arc<Mutex<Map<String, Value>>> = Arc::new(Mutex::new(Map::new()));
        let read = Arc::clone(&store);
        let write = Arc::clone(&store);
        let config = create_plugin_config(
            "todos",
            Box::new(move |k| read.lock().unwrap().get(k).cloned()),
            Box::new(move |k, v| {
                write.lock().unwrap().insert(k.to_string(), v);
            }),
        );

        config.set("theme", Value::from("dark"));
        assert_eq!(
            store.lock().unwrap().get("plugin:todos:theme"),
            Some(&Value::from("dark"))
        );
        assert_eq!(config.get("theme"), Some(Value::from("dark")));

        let all = config.get_all();
        assert_eq!(all.get("theme"), Some(&Value::from("dark")));
    }
}

// PORT STATUS: src/plugins/config-context.ts
// confidence: high
// todos: 0
// notes: prefix `plugin:<id>:` + a Mutex<Vec<String>> keys set backing getAll,
// matching the TS closure-injected getSetting/setSetting split (JSON codec stays
// in the caller's closures, as in context.ts). undefined getAll values become
// Value::Null (JS keeps the key with `undefined`).
