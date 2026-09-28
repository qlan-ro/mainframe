pub(super) fn context_window(description: &str) -> Option<i64> {
    let words: Vec<_> = description.split_whitespace().collect();
    words.windows(2).find_map(|pair| {
        let context = pair[1].trim_matches(|c: char| !c.is_ascii_alphabetic());
        context
            .eq_ignore_ascii_case("context")
            .then(|| parse_size(pair[0]))
            .flatten()
    })
}

fn parse_size(raw: &str) -> Option<i64> {
    let size = raw
        .trim_matches(['(', ')', '[', ']', ',', ':'])
        .to_ascii_lowercase();
    let (number, multiplier) = size
        .strip_suffix('k')
        .map(|n| (n, 1_000.0))
        .or_else(|| size.strip_suffix('m').map(|n| (n, 1_000_000.0)))?;
    if !number.chars().all(|c| c.is_ascii_digit() || c == '.') {
        return None;
    }
    let tokens = number.parse::<f64>().ok()? * multiplier;
    (tokens.is_finite() && tokens > 0.0 && tokens < i64::MAX as f64 && tokens.fract() == 0.0)
        .then_some(tokens as i64)
}
