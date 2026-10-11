use super::*;

pub(super) fn loop_continues(
    block: &LoopBlock,
    current: &AutomationCheckpoint,
    ctx: &WalkCtx<'_>,
    frame: &WalkFrame,
    index: u32,
) -> bool {
    // The test reads the PREVIOUS pass's outputs, so it must be built in
    // that pass's frame — a body step writes `probe#0`, which is invisible
    // from the block's own frame.
    let test_frame = match index.checked_sub(1) {
        Some(previous) => frame.pass(previous as usize),
        None => frame.clone(),
    };

    {
        let scope = build_scope(current, &test_frame, ctx.clock.clone());
        // Before the first pass there is nothing for a condition about the
        // body to read. Running it is the only useful reading: it is what
        // makes "while the build is running" work at all, and it costs
        // `until` nothing, since an `until` whose goal is already provable
        // — seeded from outside the loop — still resolves and still exits
        // at zero passes.
        if index == 0
            && !block
                .conditions
                .iter()
                .all(|c| scope.resolve(&c.token).is_some())
        {
            true
        } else {
            let matched = evaluate(&block.conditions, block.match_mode, &scope);
            match block.mode {
                LoopMode::While => matched,
                LoopMode::Until => !matched,
            }
        }
    }
}
