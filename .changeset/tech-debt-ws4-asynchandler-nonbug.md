---
---

Add regression tests proving the background-task output/kill route handlers
surface rejected promises through Express's error middleware (Express 5
forwards async-handler rejections automatically). No production change — the
audited "unwrapped asyncHandler" latent-bug does not exist under Express 5.
