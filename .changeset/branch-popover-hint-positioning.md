---
'@qlan-ro/mainframe-ui': patch
---

Fix the git branch popover never positioning its content on screen. The main toolbar wrapped the trigger button's `Hint` tooltip inside `PopoverTrigger asChild`, so Radix's Slot cloned its ref/props onto the non-forwarding `Hint` component instead of the real button — Popper never got a reference element to anchor to. `BranchPopover` now takes a `triggerLabel` prop and wraps `Hint` around `PopoverTrigger` itself, keeping the ref chain intact.
