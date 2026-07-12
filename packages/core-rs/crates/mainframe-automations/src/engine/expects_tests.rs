//! T4.4 (A2) — output contract text, correction message, and the
//! parse/validate/coerce path over the agent's final message.

use serde_json::json;

use crate::domain::{ExpectedOutput, ExpectedOutputType};

use super::expects::{build_correction_message, build_output_contract, parse_expected};

fn expect(
    key: &str,
    output_type: ExpectedOutputType,
    options: Option<Vec<&str>>,
) -> ExpectedOutput {
    ExpectedOutput {
        key: key.to_string(),
        output_type,
        options: options.map(|o| o.into_iter().map(str::to_string).collect()),
    }
}

#[test]
fn output_contract_describes_every_key_and_choice_options() {
    let expects = vec![
        expect(
            "scope",
            ExpectedOutputType::Choice,
            Some(vec!["xs", "s", "m"]),
        ),
        expect("count", ExpectedOutputType::Number, None),
        expect("summary", ExpectedOutputType::Text, None),
    ];
    assert_eq!(
        build_output_contract(&expects),
        "\n\nEnd your final message with a JSON object matching this shape (and nothing after it): \
         {\"scope\": one of [\"xs\",\"s\",\"m\"], \"count\": <number>, \"summary\": <text>}"
    );
}

#[test]
fn correction_message_carries_the_reason_and_the_contract() {
    let expects = vec![expect(
        "scope",
        ExpectedOutputType::Choice,
        Some(vec!["xs"]),
    )];
    let message = build_correction_message("missing key 'scope'", &expects);
    assert!(
        message
            .starts_with("That response didn't include the expected JSON (missing key 'scope').")
    );
    assert!(message.contains("End your final message with a JSON object"));
}

#[test]
fn parses_the_last_top_level_json_object() {
    let expects = vec![expect("scope", ExpectedOutputType::Text, None)];
    let text = "First I considered {\"scope\": \"wrong\"} but concluded:\n{\"scope\": \"right\"}";
    let outputs = parse_expected(text, &expects).unwrap();
    assert_eq!(outputs["scope"], json!("right"));
}

#[test]
fn braces_inside_strings_do_not_break_extraction() {
    let expects = vec![expect("note", ExpectedOutputType::Text, None)];
    let text = "done {\"note\": \"a } tricky { value\"}";
    let outputs = parse_expected(text, &expects).unwrap();
    assert_eq!(outputs["note"], json!("a } tricky { value"));
}

#[test]
fn no_json_object_is_a_clear_reason() {
    let expects = vec![expect("scope", ExpectedOutputType::Text, None)];
    assert_eq!(
        parse_expected("no json here", &expects).unwrap_err(),
        "no JSON object found in the response"
    );
}

#[test]
fn missing_key_names_the_key() {
    let expects = vec![expect("scope", ExpectedOutputType::Text, None)];
    assert_eq!(
        parse_expected("{\"other\": 1}", &expects).unwrap_err(),
        "missing key 'scope'"
    );
}

#[test]
fn coerces_numbers_from_numeric_strings_and_rejects_garbage() {
    let expects = vec![expect("count", ExpectedOutputType::Number, None)];
    assert_eq!(
        parse_expected("{\"count\": \"5\"}", &expects).unwrap()["count"],
        json!(5.0)
    );
    assert_eq!(
        parse_expected("{\"count\": 7}", &expects).unwrap()["count"],
        json!(7.0)
    );
    assert_eq!(
        parse_expected("{\"count\": \"many\"}", &expects).unwrap_err(),
        "'count' must be a number"
    );
}

#[test]
fn text_must_be_a_string_and_list_must_be_an_array() {
    let text_expects = vec![expect("summary", ExpectedOutputType::Text, None)];
    assert_eq!(
        parse_expected("{\"summary\": 3}", &text_expects).unwrap_err(),
        "'summary' must be a string"
    );
    let list_expects = vec![expect("items", ExpectedOutputType::List, None)];
    assert_eq!(
        parse_expected("{\"items\": [1, 2]}", &list_expects).unwrap()["items"],
        json!([1, 2])
    );
    assert_eq!(
        parse_expected("{\"items\": \"one\"}", &list_expects).unwrap_err(),
        "'items' must be a list"
    );
}

#[test]
fn choice_validates_against_options_and_stringifies() {
    let expects = vec![expect(
        "scope",
        ExpectedOutputType::Choice,
        Some(vec!["xs", "s", "m"]),
    )];
    assert_eq!(
        parse_expected("{\"scope\": \"s\"}", &expects).unwrap()["scope"],
        json!("s")
    );
    assert_eq!(
        parse_expected("{\"scope\": \"xl\"}", &expects).unwrap_err(),
        "'scope' must be one of [\"xs\",\"s\",\"m\"]"
    );
}
