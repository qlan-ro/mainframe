//! `http.request` (T6.5, Node actions/http.ts). Contract §5: outputs are
//! `{status: number, body: text}` ONLY — `headers` is dropped and `body` is
//! always raw response text (no content-type-based JSON parsing). Non-2xx
//! (>= 400, Node parity — redirects are followed) fails the step, mirroring
//! run_command's non-zero-exit convention.

use std::collections::BTreeMap;
use std::time::Duration;

use reqwest::header::{AUTHORIZATION, CONTENT_TYPE, HeaderMap, HeaderName, HeaderValue};
use serde::Deserialize;
use serde_json::{Value, json};

use crate::engine::BoxFuture;
use crate::tokens::TokenValue;

use super::manifest::{ActionAuth, ActionGroup, ActionManifest, ActionOutput, ActionOutputType};
use super::{Action, ActionCtx, ActionError, ActionOutputs, parse_input};

const DEFAULT_TIMEOUT_MS: u64 = 30_000;
const MAX_TIMEOUT_MS: u64 = 120_000;
const ERROR_BODY_SNIPPET_CHARS: usize = 500;

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
enum Method {
    Get,
    Post,
    Put,
    Patch,
    Delete,
}

impl From<Method> for reqwest::Method {
    fn from(method: Method) -> Self {
        match method {
            Method::Get => reqwest::Method::GET,
            Method::Post => reqwest::Method::POST,
            Method::Put => reqwest::Method::PUT,
            Method::Patch => reqwest::Method::PATCH,
            Method::Delete => reqwest::Method::DELETE,
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct HttpInput {
    #[serde(default)]
    method: Option<Method>,
    url: String,
    #[serde(default)]
    headers: Option<BTreeMap<String, String>>,
    /// `string | object | array` (zod union parity) — other JSON types are
    /// rejected below.
    #[serde(default)]
    body: Option<Value>,
    #[serde(default)]
    timeout_ms: Option<u64>,
}

pub struct HttpRequestAction {
    client: reqwest::Client,
}

impl HttpRequestAction {
    pub fn new() -> Self {
        Self {
            client: reqwest::Client::new(),
        }
    }
}

impl Default for HttpRequestAction {
    fn default() -> Self {
        Self::new()
    }
}

impl Action for HttpRequestAction {
    fn manifest(&self) -> ActionManifest {
        ActionManifest {
            id: "http.request",
            title: "HTTP request",
            group: ActionGroup::Builtin,
            auth: ActionAuth::Token,
            credential_label_hint: None,
            params_schema: params_schema(),
            outputs: vec![
                ActionOutput::new("status", ActionOutputType::Number),
                ActionOutput::new("body", ActionOutputType::Text),
            ],
            idempotent: false,
        }
    }

    fn execute<'a>(
        &'a self,
        params: &'a Value,
        ctx: &'a ActionCtx,
    ) -> BoxFuture<'a, Result<ActionOutputs, ActionError>> {
        Box::pin(async move {
            let input: HttpInput = parse_input("http.request", params)?;
            let url = reqwest::Url::parse(&input.url).map_err(|err| {
                invalid(format!("url '{}' is not a valid URL ({err})", input.url))
            })?;
            let timeout_ms = input.timeout_ms.unwrap_or(DEFAULT_TIMEOUT_MS);
            if timeout_ms == 0 || timeout_ms > MAX_TIMEOUT_MS {
                return Err(invalid(format!(
                    "timeoutMs must be between 1 and {MAX_TIMEOUT_MS}"
                )));
            }

            let mut headers = build_headers(input.headers.as_ref())?;
            if let Some(creds) = &ctx.creds
                && !headers.contains_key(AUTHORIZATION)
            {
                let bearer = HeaderValue::from_str(&format!("Bearer {}", creds.token))
                    .map_err(|_| invalid("credential token is not a valid header value".into()))?;
                headers.insert(AUTHORIZATION, bearer);
            }
            headers.insert(
                HeaderName::from_static("x-idempotency-key"),
                HeaderValue::from_str(&ctx.idempotency_key)
                    .unwrap_or_else(|_| HeaderValue::from_static("")),
            );

            let method = input.method.unwrap_or(Method::Get);
            let mut request = self
                .client
                .request(method.into(), url)
                .timeout(Duration::from_millis(timeout_ms));
            request = match &input.body {
                None => request,
                Some(Value::String(text)) => request.body(text.clone()),
                Some(value @ (Value::Object(_) | Value::Array(_))) => {
                    if !headers.contains_key(CONTENT_TYPE) {
                        headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
                    }
                    request.body(value.to_string())
                }
                Some(_) => {
                    return Err(invalid("body must be a string, object, or array".into()));
                }
            };

            let response = request.headers(headers).send().await.map_err(|err| {
                ActionError(format!("HTTP request to {} failed: {err}", input.url))
            })?;
            let status = response.status().as_u16();
            let body = response.text().await.map_err(|err| {
                ActionError(format!("HTTP request to {} failed: {err}", input.url))
            })?;
            if status >= 400 {
                let snippet: String = body.chars().take(ERROR_BODY_SNIPPET_CHARS).collect();
                return Err(ActionError(format!(
                    "HTTP {status} from {}: {snippet}",
                    input.url
                )));
            }

            let mut outputs = ActionOutputs::new();
            outputs.insert("status".to_string(), TokenValue::Number(f64::from(status)));
            outputs.insert("body".to_string(), TokenValue::Text(body));
            Ok(outputs)
        })
    }
}

fn build_headers(input: Option<&BTreeMap<String, String>>) -> Result<HeaderMap, ActionError> {
    let mut headers = HeaderMap::new();
    if let Some(map) = input {
        for (name, value) in map {
            let header_name = HeaderName::from_bytes(name.as_bytes())
                .map_err(|_| invalid(format!("'{name}' is not a valid header name")))?;
            let header_value = HeaderValue::from_str(value)
                .map_err(|_| invalid(format!("header '{name}' has an invalid value")))?;
            headers.insert(header_name, header_value);
        }
    }
    Ok(headers)
}

fn invalid(detail: String) -> ActionError {
    ActionError(format!("invalid input for 'http.request': {detail}"))
}

fn params_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "method": {"type": "string", "enum": ["GET", "POST", "PUT", "PATCH", "DELETE"], "default": "GET"},
            "url": {"type": "string", "format": "uri"},
            "headers": {"type": "object", "additionalProperties": {"type": "string"}},
            "body": {"anyOf": [{"type": "string"}, {"type": "object"}, {"type": "array"}]},
            "timeoutMs": {"type": "integer", "minimum": 1, "maximum": 120000, "default": 30000}
        },
        "required": ["url"],
        "additionalProperties": false
    })
}

// PORT STATUS: greenfield (docs/plans/2026-07-12-automations-v2-rust-engine.md T6.5), not a TS port
// confidence: high
// todos: 0
// notes: mirrors Node actions/http.ts (bearer-unless-authored auth,
//        x-idempotency-key, JSON body content-type, >=400 throw); reqwest
//        follows redirects like fetch.
