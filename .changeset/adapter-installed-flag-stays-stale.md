---
'@qlan-ro/mainframe-types': patch
'@qlan-ro/mainframe-ui': patch
---

Stop showing a padlock on providers that are installed. The boot snapshot reports every adapter as uninstalled when the CLI probe outruns the daemon's 2s cap, and the follow-up catalog event refreshed the models without clearing that flag — so a brand-new session could offer Claude's full model list while both provider tabs sat disabled. The event now carries the probe's verdict, and the client applies it.
