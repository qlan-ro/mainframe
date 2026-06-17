---
"@qlan-ro/mainframe-app-tauri": patch
---

Tasks board/list artboard parity: the board is a 3-column grid with 1px hairline
separators and flush content2 columns (uppercase headers + mono count chips); task
cards are white (bg-background) 8px/0.5px cards that pop against the column, list
rows gain a type badge, the filter trigger uses the accent-tint active style, the
list group headers are sticky content2 with kbd-chip footer hints, and the three
task dialogs pass hideClose so only their own header close renders (no double X).
