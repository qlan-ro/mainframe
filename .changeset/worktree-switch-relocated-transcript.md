---
'@qlan-ro/mainframe-ui': patch
---

Fix "Could not switch worktree — No such file or directory (os error 2)" when accepting a worktree-switch offer. Claude's own worktree tool relocates the session transcript as soon as the agent enters the worktree, so by the time the daemon rebinds the chat there is nothing left to move. That absence is now expected rather than fatal. When the move does fail for a real reason, the chat restarts on its current binding instead of being left stopped and unbound, and the toast explains what happened instead of quoting the raw OS error. Moving session files also no longer overwrites a transcript that is already at the destination, so a leftover file in the old directory cannot replace the live one. After a successful move the chat's stored transcript path now follows the transcript into the worktree instead of pointing at the directory it just left.

Worktree offers no longer go missing after a worktree is deleted and recreated at the same path. A chat now remembers each worktree it has already seen by identity rather than by path alone, and refreshes that record on every scan instead of freezing it when the chat starts. A worktree rebuilt in place is a different worktree, so it is offered again — even when the remove and the add run as a single command and the path never appears to have gone away.

Switching worktrees mid-session no longer leaves the thread stuck on "Composing…" with a Stop button. The switch restarts the CLI, and the restart alone was being read as a turn in flight; since no turn was running, nothing ever arrived to clear it.
