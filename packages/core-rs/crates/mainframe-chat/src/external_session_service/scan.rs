use super::*;

pub(super) async fn scan_page_impl<D: ExternalSessionDeps>(
    deps: &D,
    project_id: &str,
    offset: i64,
    limit: i64,
) -> ExternalSessionPage {
    let Some(project) = deps.projects_get_path(project_id) else {
        return ExternalSessionPage {
            sessions: Vec::new(),
            total: 0,
            next_offset: None,
        };
    };

    let adapter_ids = deps.external_session_adapter_ids();
    let exclude_ids = deps.get_imported_session_ids(project_id);

    // Count-only: each adapter returns its total without enriching.
    if limit <= 0 {
        let mut total = 0;
        for adapter_id in &adapter_ids {
            match deps
                .list_external_sessions(adapter_id, &project, &exclude_ids, 0, 0)
                .await
            {
                Ok(page) => total += page.total,
                Err(err) => {
                    warn!(
                        ?err,
                        adapter_id, project_id, "Failed to count external sessions"
                    )
                }
            }
        }
        return ExternalSessionPage {
            sessions: Vec::new(),
            total,
            next_offset: None,
        };
    }

    // Over-fetch each adapter's prefix [0, offset+limit), then merge-sort across
    // adapters by modifiedAt desc and slice the requested page. This is correct
    // for any number of session-listing adapters (claude + codex today).
    let prefix_limit = offset + limit;
    let mut collected: Vec<ExternalSession> = Vec::new();
    let mut total = 0;
    for adapter_id in &adapter_ids {
        match deps
            .list_external_sessions(adapter_id, &project, &exclude_ids, 0, prefix_limit)
            .await
        {
            Ok(mut page) => {
                for s in &mut page.sessions {
                    s.adapter_id = adapter_id.clone();
                }
                total += page.total;
                collected.extend(page.sessions);
            }
            Err(err) => {
                warn!(
                    ?err,
                    adapter_id, project_id, "Failed to scan external sessions"
                )
            }
        }
    }

    collected.sort_by(|a, b| {
        let d = parse_ms(&b.modified_at) - parse_ms(&a.modified_at);
        if d != 0 {
            if d > 0 {
                Ordering::Greater
            } else {
                Ordering::Less
            }
        } else if a.session_id < b.session_id {
            Ordering::Greater
        } else {
            Ordering::Less
        }
    });

    let len = collected.len() as i64;
    let start = offset.clamp(0, len) as usize;
    let end = (offset + limit).clamp(0, len) as usize;
    let sessions = collected[start..end].to_vec();
    let next_offset = if offset + limit < total {
        Some(offset + limit)
    } else {
        None
    };
    ExternalSessionPage {
        sessions,
        total,
        next_offset,
    }
}

pub(super) async fn generate_import_title<D: ExternalSessionDeps>(
    deps: &D,
    chat: &mut Chat,
    content: &str,
    adapter_id: &str,
) {
    if read_setting(deps.settings(), "general", "titleGeneration.disabled")
        .await
        .as_deref()
        == Some("true")
    {
        debug!(
            chat_id = %chat.id,
            adapter_id,
            reason = "disabled_by_setting",
            "title generation skipped"
        );
        return;
    }

    let binary = resolve_title_binary(
        read_setting(
            deps.settings(),
            "provider",
            &format!("{adapter_id}.titleBinary"),
        )
        .await,
        adapter_id,
    );
    let Some(title) = deps.generate_title(adapter_id, content, &binary).await else {
        debug!(
            chat_id = %chat.id,
            adapter_id,
            reason = "no_title",
            "title generation produced no title"
        );
        return;
    };

    chat.title = Some(title.clone());
    deps.chats_update(
        &chat.id,
        &ChatPatch {
            title: Some(title),
            ..Default::default()
        },
    );
    deps.emit_event(DaemonEvent::ChatUpdated {
        chat: chat.clone(),
        reason: None,
    });
}

pub(super) async fn emit_count<D: ExternalSessionDeps>(
    deps: &D,
    last_counts: &Mutex<HashMap<String, i64>>,
    project_id: &str,
) {
    let page = scan_page_impl(deps, project_id, 0, 0).await; // count-only (no enrichment)
    let total = page.total;
    let last = last_counts.lock_recover().get(project_id).copied();
    if last != Some(total) {
        last_counts
            .lock_recover()
            .insert(project_id.to_string(), total);
        deps.emit_event(DaemonEvent::SessionsExternalCount {
            project_id: project_id.to_string(),
            count: total,
        });
    }
}

/// `new Date(s).getTime()` — parse an ISO-8601 timestamp to epoch ms (0 on failure).
fn parse_ms(s: &str) -> i64 {
    chrono::DateTime::parse_from_rfc3339(s)
        .map(|d| d.timestamp_millis())
        .unwrap_or(0)
}

/// Remove XML-like tags and collapse whitespace, returning empty string if nothing remains.
pub(super) fn strip_xml_tags(text: &str) -> String {
    // /<[^>]+>/g → ' ', then /\s+/g → ' ', trim.
    let chars: Vec<char> = text.chars().collect();
    let mut without_tags = String::new();
    let mut i = 0;
    while i < chars.len() {
        // `<[^>]+>` — `<`, then ≥1 non-`>` char, then `>`. A bare `<>` or an
        // unclosed `<` is not a tag and is preserved.
        if chars[i] == '<'
            && let Some(close_rel) = chars[i + 1..].iter().position(|c| *c == '>')
            && close_rel >= 1
        {
            without_tags.push(' ');
            i = i + 1 + close_rel + 1;
            continue;
        }
        without_tags.push(chars[i]);
        i += 1;
    }
    // collapse whitespace runs to a single space, trim
    let mut out = String::new();
    let mut prev_ws = false;
    for c in without_tags.chars() {
        if c.is_whitespace() {
            if !prev_ws {
                out.push(' ');
                prev_ws = true;
            }
        } else {
            out.push(c);
            prev_ws = false;
        }
    }
    out.trim().to_string()
}
