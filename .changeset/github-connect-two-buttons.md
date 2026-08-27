---
'@qlan-ro/mainframe-ui': patch
---

Tell GitHub's two connect buttons apart

With a GitHub App client ID configured, the credential field offered two buttons that both read "Connect GitHub…" — one starting device-flow sign-in, one opening the token field. Nothing distinguished them.

Sign-in now leads as the primary action and says "Sign in with GitHub"; the token path sits below it as "Use a personal access token…". With no client ID configured, the token button is the only one and reads "Connect GitHub…" as before.
