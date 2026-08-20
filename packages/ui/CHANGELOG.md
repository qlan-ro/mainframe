# @qlan-ro/mainframe-ui

## 2.1.1

### Patch Changes

- [#677](https://github.com/qlan-ro/mainframe/pull/677) [`7bc0ef3`](https://github.com/qlan-ro/mainframe/commit/7bc0ef3a1db69ee19d26e4abf0b128492832e98e) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Connect GitHub by signing in, or by pasting a token.

  The previous release removed the `gh` command-line tool and left sign-in as the only option, before any app existed to sign in to — so GitHub actions could not be authenticated at all, and the editor told you to ask an administrator who does not exist on your own machine. GitHub now always accepts a pasted token, like Notion and Azure DevOps, with sign-in offered alongside it.

  Sign-in uses a GitHub App, whose access lasts eight hours and is renewed automatically in the background, so a scheduled automation running overnight keeps working.

  A GitHub App also has to be installed on the repositories you want it to touch, which is easy to miss because signing in appears to succeed. If a step then fails, it now says the app is not installed on that organization and links you to the install page, rather than reporting a plain "not found".

- Updated dependencies [[`7bc0ef3`](https://github.com/qlan-ro/mainframe/commit/7bc0ef3a1db69ee19d26e4abf0b128492832e98e)]:
  - @qlan-ro/mainframe-types@2.1.1
