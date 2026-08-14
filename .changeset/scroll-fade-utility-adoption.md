---
'@qlan-ro/mainframe-ui': patch
---

Replace the sidebar's hand-rolled scroll-edge fade with the shadcn `scroll-fade` utility, keeping only the sticky-header inset measurement and feeding it through the utility's mask override. The session panel's card bodies, the session tab strip, and the attachment rail now fade with content past their edges instead of clipping. The workspace tab strip also picked up the fade — it wasn't named in the brief, but leaving it clipped beside a fading session tab strip would keep the exact inconsistency this change removes.
