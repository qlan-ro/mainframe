use mainframe_acp::{encoder, session_state::SessionState};
use mainframe_types::display::DisplayMessage;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let path = std::env::args()
        .nth(1)
        .ok_or("expected display JSON path")?;
    let messages: Vec<DisplayMessage> = serde_json::from_slice(&std::fs::read(path)?)?;
    let items = encoder::encode(&messages);
    let updates = SessionState::new().diff(&items);
    serde_json::to_writer_pretty(std::io::stdout(), &updates)?;
    Ok(())
}
