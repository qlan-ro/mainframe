# Signing & Distribution Setup Guide

Step-by-step instructions for setting up code signing for the Electron desktop app and build/submission for the Expo mobile app.

## Part 1: Electron macOS Code Signing

### Step 1 — Create a Developer ID Application Certificate

1. Open **Xcode** > Settings > Accounts > your Apple ID > Manage Certificates
2. Click **+** > **Developer ID Application**
3. Xcode creates the certificate and installs it in your Keychain

Alternatively, use the [Apple Developer portal](https://developer.apple.com/account/resources/certificates/list):
- Certificates, Identifiers & Profiles > Certificates > **+**
- Select **Developer ID Application**
- Upload a Certificate Signing Request (create one via Keychain Access > Certificate Assistant > Request a Certificate)
- Download and double-click to install

### Step 2 — Export the Certificate as .p12

1. Open **Keychain Access**
2. Find your "Developer ID Application: ..." certificate (under **My Certificates**)
3. Right-click > **Export...**
4. Save as `.p12`, set a strong password — you'll need this password as `CSC_KEY_PASSWORD`

### Step 3 — Base64-encode the .p12

```bash
base64 -i ~/path/to/certificate.p12 | pbcopy
```

The encoded string is now in your clipboard. This is your `CSC_LINK` value.

### Step 4 — Create an App-Specific Password

1. Go to [appleid.apple.com](https://appleid.apple.com)
2. Sign-In & Security > **App-Specific Passwords** > Generate
3. Name it something like "Mainframe Notarization"
4. Copy the generated password — this is your `APPLE_APP_SPECIFIC_PASSWORD`

### Step 5 — Find Your Team ID

1. Go to [developer.apple.com/account](https://developer.apple.com/account)
2. Membership Details (or scroll to the bottom)
3. Copy the **Team ID** (10-character alphanumeric string)

### Step 6 — Add Secrets to GitHub

Go to your repo: **Settings > Secrets and variables > Actions > New repository secret**

Add these five secrets:

| Secret name | Value |
|-------------|-------|
| `CSC_LINK` | Base64-encoded .p12 from Step 3 |
| `CSC_KEY_PASSWORD` | Password from Step 2 |
| `APPLE_ID` | Your Apple ID email |
| `APPLE_APP_SPECIFIC_PASSWORD` | App-specific password from Step 4 |
| `APPLE_TEAM_ID` | Team ID from Step 5 |

### Step 7 — Verify

Push a tag to trigger a release build:

```bash
git tag v0.3.0
git push origin v0.3.0
```

Check the GitHub Actions run. The macOS job should show signing and notarization in its logs. The Windows and Linux jobs skip signing automatically.

### Local Signing (Optional)

To sign locally, export the env vars before running the package command:

```bash
export CSC_LINK="$(base64 -i ~/path/to/certificate.p12)"
export CSC_KEY_PASSWORD="your-password"
export APPLE_ID="you@example.com"
export APPLE_APP_SPECIFIC_PASSWORD="xxxx-xxxx-xxxx-xxxx"
export APPLE_TEAM_ID="XXXXXXXXXX"
pnpm --filter @qlan-ro/mainframe-desktop package
```

Without these env vars, `electron-builder` produces unsigned builds — no errors, no config changes needed.

---

## Part 2: Expo Mobile App (EAS Build)

### Step 1 — Create an Expo Account & Organization

1. Go to [expo.dev](https://expo.dev) and sign up (or log in)
2. The `owner` in `app.json` is `qlan-ro` — create an organization with that name if it doesn't exist: Account Settings > Organizations > Create

### Step 2 — Generate an Expo Access Token

1. Go to [expo.dev](https://expo.dev) > Account Settings > Access Tokens
2. Click **Create Token**
3. Name: "GitHub Actions"
4. Copy the token

### Step 3 — Add EXPO_TOKEN to GitHub Secrets

Go to the **`qlan-ro/mainframe-mobile`** repo (not the root monorepo): **Settings > Secrets and variables > Actions > New repository secret**

| Secret name | Value |
|-------------|-------|
| `EXPO_TOKEN` | The token from Step 2 |

### Step 4 — Set Up iOS Credentials (EAS Managed)

Run this once from your local machine:

```bash
cd packages/mobile
npx eas-cli credentials --platform ios
```

EAS will prompt you to:
1. Log in to your Apple Developer account
2. Select your Team
3. Let EAS create and manage your Distribution Certificate and Provisioning Profile

EAS stores these in its cloud. You don't need to manage `.p12` files or provisioning profiles manually for mobile.

### Step 5 — Set Up Android Credentials

Run this once from your local machine:

```bash
cd packages/mobile
npx eas-cli credentials --platform android
```

EAS will generate and store a signing keystore. No manual setup needed.

### Step 6 — First Build (Test)

Run a test build to verify everything works:

```bash
cd packages/mobile

# iOS
npx eas-cli build --platform ios --profile preview

# Android
npx eas-cli build --platform android --profile preview
```

These `preview` builds use `distribution: internal` — they produce installable artifacts for testing (`.ipa` via ad-hoc, `.apk`/`.aab` for sideloading).

### Step 7 — App Store Connect Setup (iOS Submission)

1. Go to [App Store Connect](https://appstoreconnect.apple.com)
2. My Apps > **+** > New App
   - Platform: iOS
   - Name: Mainframe
   - Bundle ID: `ro.qlan.mainframe.app` (register it first under Identifiers in the Developer portal if needed)
   - SKU: `mainframe-ios`
3. Fill in the required metadata (description, screenshots, categories)

For automated submission from CI, create an **App Store Connect API Key**:
1. App Store Connect > Users and Access > Integrations > App Store Connect API > **+**
2. Name: "Mainframe CI", Access: App Manager
3. Download the `.p8` key file
4. Note the **Key ID** and **Issuer ID**
5. Run `npx eas-cli credentials --platform ios` and select "App Store Connect API Key" when prompted, then provide the Key ID, Issuer ID, and `.p8` file path

### Step 8 — Google Play Console Setup (Android Submission)

1. Go to [Google Play Console](https://play.google.com/console)
2. Create a new app: "Mainframe", package name `ro.qlan.mainframe.app`
3. Complete the store listing (description, screenshots, content rating, etc.)

For automated submission, create a Google Cloud Service Account:
1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create a project (or use existing)
3. Enable the **Google Play Android Developer API**
4. IAM & Admin > Service Accounts > Create
5. Grant it the "Service Account User" role
6. Create a JSON key and download it
7. In Google Play Console: Setup > API Access > link the Google Cloud project > grant the service account "Release Manager" access
8. Run `npx eas-cli credentials --platform android` and provide the service account JSON when prompted

### Step 9 — Trigger a Mobile Release

From the mobile submodule directory:

```bash
cd packages/mobile
git tag v0.1.0
git push origin v0.1.0
```

The `release.yml` workflow in `qlan-ro/mainframe-mobile` will build both platforms on EAS Cloud and submit to both stores.

---

## Quick Reference

| What | Trigger | Where it runs |
|------|---------|---------------|
| Desktop release (all platforms) | Push `v*` tag | GitHub Actions (macOS/Windows/Linux runners) |
| Mobile release (iOS + Android) | Push `v*` tag in `mainframe-mobile` repo | GitHub Actions → EAS Cloud |
| Desktop signing | Automatic if `CSC_LINK` secret exists | macOS runner only |
| Mobile signing | Automatic via EAS managed credentials | EAS Cloud |
