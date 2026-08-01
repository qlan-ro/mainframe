//! Greenfield (todo #243): `/api/projects/{id}/skills-cli/…` — installs and
//! uninstalls skills via the `skills` CLI. The service layer
//! (`skills_cli::{manifest,probe,install,uninstall}`) does the validation and
//! CLI work; this module only resolves the project, parses the request shape,
//! and maps `SkillsCliError` onto the wire contract.

use std::sync::Arc;

use axum::Router;
use axum::body::Bytes;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use serde::Deserialize;
use serde_json::json;

use crate::ctx::AppCtx;
use crate::respond::{fail, ok, ok_empty};
use crate::routes::files::resolve_base;
use crate::routes::projects::parse_body;
use crate::skills_cli::{
    self, ManifestOutcome, ProbeOutcome, ProcessRunner, Scope, SkillsCliError,
};

fn fail_with_tail(error: &str, tail: &str, exit_code: Option<i32>) -> Response {
    (
        StatusCode::BAD_GATEWAY,
        axum::Json(json!({
            "success": false,
            "error": error,
            "tail": tail,
            "exitCode": exit_code,
        })),
    )
        .into_response()
}

fn map_error(operation: &str, project_id: &str, err: SkillsCliError) -> Response {
    match err {
        SkillsCliError::Rejected(reason) => fail(StatusCode::BAD_REQUEST, reason),
        SkillsCliError::Busy => fail(
            StatusCode::CONFLICT,
            "A skills operation is already running for this project",
        ),
        SkillsCliError::Cli {
            reason,
            tail,
            exit_code,
        } => {
            tracing::warn!(
                project_id,
                operation,
                exit_code,
                "skills CLI operation failed"
            );
            fail_with_tail(&reason, &tail, exit_code)
        }
    }
}

// Returns `None` rather than `Result<_, Response>` — clippy's `result_large_err`
// flags a `Response`-sized `Err`, and the two call sites already build the
// rejection response themselves.
fn parse_scope(raw: Option<&str>) -> Option<Scope> {
    match raw {
        Some("project") => Some(Scope::Project),
        Some("global") => Some(Scope::Global),
        _ => None,
    }
}

fn manifest_json(outcome: ManifestOutcome) -> serde_json::Value {
    match outcome {
        ManifestOutcome::Available { entries } => {
            let entries: Vec<serde_json::Value> = entries
                .iter()
                .map(|e| {
                    json!({
                        "name": e.name,
                        "scope": match e.scope { Scope::Project => "project", Scope::Global => "global" },
                        "source": e.source,
                        "sourceType": e.source_type,
                        "skillPath": e.skill_path,
                    })
                })
                .collect();
            json!({ "status": "available", "entries": entries })
        }
        ManifestOutcome::Unavailable {
            executable,
            package_runner,
        } => {
            json!({ "status": "unavailable", "executable": executable, "packageRunner": package_runner })
        }
    }
}

fn probe_json(outcome: ProbeOutcome) -> serde_json::Value {
    match outcome {
        ProbeOutcome::Probed { skills } => {
            let skills: Vec<serde_json::Value> = skills
                .into_iter()
                .map(|s| json!({ "name": s.name, "description": s.description }))
                .collect();
            json!({ "status": "probed", "skills": skills })
        }
        ProbeOutcome::Unparseable => json!({ "status": "unparseable" }),
    }
}

// The wire contract documents an optional `?adapterId=` on this route for
// symmetry with the other three, but `skills_cli::manifest` lists every
// installed skill regardless of which adapter is asking — axum ignores
// unrecognized query params, so there's nothing to parse here.
async fn manifest(State(ctx): State<Arc<AppCtx>>, Path(id): Path<String>) -> Response {
    let base = match resolve_base(&ctx, &id, None).await {
        Ok(b) => b,
        Err(resp) => return resp,
    };
    let runner = ProcessRunner::new(ctx.resolved_path.clone());
    match skills_cli::manifest(&runner, &ctx.resolved_path, &id, &base).await {
        Ok(outcome) => ok(manifest_json(outcome)),
        Err(err) => map_error("manifest", &id, err),
    }
}

#[derive(Deserialize)]
struct ProbeBody {
    source: Option<String>,
}

async fn probe(State(ctx): State<Arc<AppCtx>>, Path(id): Path<String>, body: Bytes) -> Response {
    let base = match resolve_base(&ctx, &id, None).await {
        Ok(b) => b,
        Err(resp) => return resp,
    };
    let Some(parsed) = parse_body::<ProbeBody>(&body) else {
        return fail(StatusCode::BAD_REQUEST, "Invalid request body");
    };
    let Some(source) = parsed.source.filter(|s| !s.is_empty()) else {
        return fail(StatusCode::BAD_REQUEST, "source is required");
    };
    let runner = ProcessRunner::new(ctx.resolved_path.clone());
    match skills_cli::probe(&runner, &ctx.resolved_path, &id, &base, &source).await {
        Ok(outcome) => ok(probe_json(outcome)),
        Err(err) => map_error("probe", &id, err),
    }
}

#[derive(Deserialize)]
struct InstallBody {
    source: Option<String>,
    skills: Option<Vec<String>>,
    scope: Option<String>,
    #[serde(rename = "adapterId")]
    adapter_id: Option<String>,
}

async fn install(State(ctx): State<Arc<AppCtx>>, Path(id): Path<String>, body: Bytes) -> Response {
    let base = match resolve_base(&ctx, &id, None).await {
        Ok(b) => b,
        Err(resp) => return resp,
    };
    let Some(parsed) = parse_body::<InstallBody>(&body) else {
        return fail(StatusCode::BAD_REQUEST, "Invalid request body");
    };
    let Some(source) = parsed.source.filter(|s| !s.is_empty()) else {
        return fail(StatusCode::BAD_REQUEST, "source is required");
    };
    let Some(scope) = parse_scope(parsed.scope.as_deref()) else {
        return fail(
            StatusCode::BAD_REQUEST,
            "scope must be \"project\" or \"global\"",
        );
    };
    let skills = parsed.skills.unwrap_or_default();
    let runner = ProcessRunner::new(ctx.resolved_path.clone());
    let result = skills_cli::install(
        &runner,
        &ctx.resolved_path,
        &id,
        &base,
        &source,
        &skills,
        scope,
        parsed.adapter_id.as_deref(),
    )
    .await;
    match result {
        Ok(()) => ok_empty(),
        Err(err) => map_error("install", &id, err),
    }
}

#[derive(Deserialize)]
struct UninstallBody {
    skills: Option<Vec<String>>,
    scope: Option<String>,
    #[serde(rename = "adapterId")]
    adapter_id: Option<String>,
}

async fn uninstall(
    State(ctx): State<Arc<AppCtx>>,
    Path(id): Path<String>,
    body: Bytes,
) -> Response {
    let base = match resolve_base(&ctx, &id, None).await {
        Ok(b) => b,
        Err(resp) => return resp,
    };
    let Some(parsed) = parse_body::<UninstallBody>(&body) else {
        return fail(StatusCode::BAD_REQUEST, "Invalid request body");
    };
    let Some(scope) = parse_scope(parsed.scope.as_deref()) else {
        return fail(
            StatusCode::BAD_REQUEST,
            "scope must be \"project\" or \"global\"",
        );
    };
    let skills = parsed.skills.unwrap_or_default();
    let runner = ProcessRunner::new(ctx.resolved_path.clone());
    let result = skills_cli::uninstall(
        &runner,
        &ctx.resolved_path,
        &id,
        &base,
        &skills,
        scope,
        parsed.adapter_id.as_deref(),
    )
    .await;
    match result {
        Ok(()) => ok_empty(),
        Err(err) => map_error("uninstall", &id, err),
    }
}

pub fn router() -> Router<Arc<AppCtx>> {
    Router::new()
        .route("/api/projects/{id}/skills-cli/manifest", get(manifest))
        .route("/api/projects/{id}/skills-cli/probe", post(probe))
        .route("/api/projects/{id}/skills-cli/install", post(install))
        .route("/api/projects/{id}/skills-cli/uninstall", post(uninstall))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::skills_cli::{ProbedSkill, SkillsCliEntry};

    // Pins the wire contract the TS `SkillsCliEntrySchema`/`ProbedSkillSchema`
    // now decode with `.nullish()`: a name-only entry or bare-name probe
    // candidate serializes its absent fields as explicit JSON `null`, not an
    // omitted key.
    #[test]
    fn manifest_json_serializes_a_name_only_entry_with_explicit_null_fields() {
        let outcome = ManifestOutcome::Available {
            entries: vec![SkillsCliEntry {
                name: "no-source".to_string(),
                scope: Scope::Project,
                source: None,
                source_type: None,
                skill_path: None,
            }],
        };

        let json = manifest_json(outcome);

        let entry = &json["entries"][0];
        assert_eq!(entry["name"], "no-source");
        assert!(entry["source"].is_null());
        assert!(entry["sourceType"].is_null());
        assert!(entry["skillPath"].is_null());
    }

    #[test]
    fn probe_json_serializes_a_bare_name_candidate_with_an_explicit_null_description() {
        let outcome = ProbeOutcome::Probed {
            skills: vec![ProbedSkill {
                name: "bare-name".to_string(),
                description: None,
            }],
        };

        let json = probe_json(outcome);

        let skill = &json["skills"][0];
        assert_eq!(skill["name"], "bare-name");
        assert!(skill["description"].is_null());
    }
}
