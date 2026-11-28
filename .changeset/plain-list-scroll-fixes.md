---
'@qlan-ro/mainframe-ui': patch
---

Plain transcript list (preview): a reader who scrolled up during a reply is no longer pulled back to the bottom when content below them shrinks, and a turn that ends while they read folds only once they return to the latest message. Sending no longer leaves the view a few pixels to a whole turn above the bottom. A folded turn's messages that show nothing no longer get a row each, so an older page of a large chat mounts in a fraction of the time. On launch, the cover over a restored chat no longer waits out its deadline when the plain list draws no message rows, or when the tail ends in a system marker.
