# Tooltips on Truncated Text

## Decision

Add native `title` attributes to all truncated text elements across the UI. No new components or dependencies.

## Scope

~24 files, each getting 1-3 `title=` additions on elements that use CSS `truncate` or JS string truncation.

### Tool cards (chat stream)

| File | What gets a title |
|------|-------------------|
| BashCard | full command, description |
| ReadFileCard | full file path |
| WriteFileCard | full file path |
| EditFileCard | full file path |
| SearchCard | full pattern |
| TaskCard | full description |
| TaskGroupCard | full description |
| ToolGroupCard | full label |
| SlashCommandCard | full args |
| TaskProgressCard | full text |

### Panels (sidebars)

| File | What gets a title |
|------|-------------------|
| FileViewHeader | name, dir |
| FilesTab | project path, file names |
| ChangesTab | file paths |
| ChatsPanel | chat titles |
| ChatSessionBar | branch name |
| AgentsPanel | name, description |
| SkillsPanel | name, description |

### Menus and other

| File | What gets a title |
|------|-------------------|
| SearchPalette | labels, details |
| AtMentionMenu | names, descriptions |
| SlashCommandMenu | descriptions |
| MonacoEditor | file path |
| LineCommentPopover | trimmed line |

### Already handled (no change)

ContextFileItem, ProjectRail, SessionAttachmentsGrid already use `title`.
