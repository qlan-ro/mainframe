---
'@qlan-ro/mainframe-desktop': patch
---

fix(editor): apply InlineCommentWidget width after Monaco's addZone, not before. Monaco's view-zones implementation sets `domNode.style.width = '100%'` inside `_addZone`, clobbering the contentWidth-based width we were setting beforehand. The first widget happened to get corrected by a later layout event; subsequent widgets stayed at full width. Width is now re-applied after addZone, and an `onDidContentSizeChange` listener keeps every open widget in sync when a scrollbar toggles.
