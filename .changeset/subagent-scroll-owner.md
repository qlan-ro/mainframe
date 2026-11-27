---
'@qlan-ro/mainframe-ui': patch
---

A saved sub-agent's steps keep the reader's place when an older page loads, and stay bounded: at most three pages are held, inline and in the agent tab, and a "Later messages" button brings back the newest ones after scrolling far up. On the plain transcript list the agent tab gets the transcript's scroll owner, so a page landing at the top of the tab no longer pushes the reader's steps away.
