# GenPass - Password Generator & 2FA (TOTP) Authenticator

[English](README_EN.md) | [Tiếng Việt](README.md)

GenPass is an open-source, 100% offline-first browser extension (Chrome Extension Manifest V3). It combines an industry-standard password generator (supporting random character passwords and Diceware Passphrases), RFC 6238-compliant 2FA/TOTP two-factor authentication, secure notes, multi-account cookie switching, payment profile storage, and a convenient right-click context menu.

All data is stored locally on your device via `chrome.storage.local`. Nothing is ever sent to any remote third-party server or cloud service.

---

## Key Features

| Feature Group | Details |
| :--- | :--- |
| **Random Passwords** | Length 5 - 64 characters, Uppercase, Lowercase, Numbers, Symbols, ambiguous character filter (`l`, `1`, `I`, `0`, `O`...). |
| **Diceware Passphrase** | EFF 1,296-word memorable list, 3 - 10 words, custom separator (`-`, `_`, `.`, space), word capitalization, optional random digits. |
| **2FA (TOTP)** | Compatible with Google Authenticator / Authy, RFC 6238 standard (6 digits, 30s cycle). Enter Base32 key, `otpauth://` link, upload QR image, or scan screen directly. |
| **Cross-Platform QR Scanner** | Pure JavaScript `jsQR` decoder, runs reliably on Windows, macOS, and Linux without native browser barcode APIs. Includes internal SSRF protection. |
| **Secure Notes** | Store 2FA recovery backup codes, ATM PINs, and security questions. 1-click fast copy and live search. |
| **Payment Profiles (Google Pay, PayPal, Cards)** | Store credit/debit cards (Visa, Mastercard, JCB, Amex, Napas...) with Google Pay / PayPal billing address format (Name, Card Number, CVV, Expiration, Street Address, City, State/Province, Zip/Postal code, Email, Phone). Integrated Luhn checksum, card masking, and 1-click copy-all. |
| **Cookie Manager & Session Switcher** | Manage multi-account login sessions per domain completely offline: save current session, 1-click account switch with automatic page reload, export/import JSON cookies (Cookie-Editor format), 1-click logout by clearing domain cookies. |
| **History & Live Search** | Stores up to 200 recent entries categorized by tags. Displays usernames/emails and service names. Real-time search by keywords. |
| **Context Menu (Right-Click)** | Right-click to generate passwords by preset, scan QR codes from image or full screen, and autofill credentials or OTP codes. Bilingual VI/EN support. |
| **React / Vue 16+ Compatibility** | Uses Native Value Setter descriptors so autofill triggers proper input events on reactive forms without swallowed keystrokes. |
| **Clipboard Security** | Automatically clears copied passwords or OTP codes from clipboard after 30 seconds if no new content is copied. |
| **Argon2id + AES-256-GCM Vault** | Protects the local vault with a master PIN/password, automatic relock upon popup close or idle timeout. Rate-limiting prevents automated brute-force attempts. |
| **Bilingual UI (i18n)** | 1-click toggle between Vietnamese and English directly on the popup header. |
| **Auto Update Checks** | Periodically checks GitHub releases every 12 hours, displaying a `NEW` badge when an update is available. |
| **HaveIBeenPwned Breach Check** | Checks newly generated passwords against global breach datasets via k-Anonymity API (sends only 5-char SHA-1 prefix) with zero plaintext leak. |
| **Encrypted Vault Backup (.gpvault)** | Exports and restores the full encrypted vault (passwords, 2FA, cards, cookies) as a standalone AES-256-GCM + Argon2id container, safe for cloud storage. |
| **Full RFC 6238 TOTP Engine** | Supports SHA-1, SHA-256, SHA-512, 6 or 8 digits, and custom time steps (15s, 30s, 60s) for enterprise 2FA tokens. |
| **CSV Import & Export** | Standard CSV format (`name,url,username,password,note`) with built-in Formula Injection (CWE-1236) sanitization. |

---

## Installation Guide

Compatible with all modern Chromium-based browsers (Google Chrome, Microsoft Edge, Brave, Opera, Vivaldi, Cốc Cốc).

### Install from Source (Developer Mode)

1. Clone or download this repository:
   ```bash
   git clone https://github.com/lengoctuong2005/GenPass.git
   ```
2. Open your browser and navigate to the Extensions management page:
   - Google Chrome / Brave: `chrome://extensions`
   - Microsoft Edge: `edge://extensions`
3. Enable **Developer mode** toggle in the top-right corner.
4. Click the **Load unpacked** button in the top-left corner.
5. Select the downloaded `GenPass` directory to complete installation.

---

## Detailed Usage Guide

### 1. Generating Passwords or Passphrases
1. Click the GenPass icon on your browser toolbar.
2. Under the **Passwords** tab, select your mode:
   - **Password**: Adjust the length slider (5-64) and toggle character sets.
   - **Passphrase**: Choose word count (default 4 words), separator character (hyphen, underscore, space...), and optional capitalization or digits.
3. Fill in the Service Name (e.g. `GitHub`), Username/Email, category Tag, and Secure Notes if needed.
4. Click **Copy**: The password is copied to your clipboard and saved to History.

### 2. Using the Right-Click Context Menu
Right-click anywhere on a webpage to access the `GenPass` menu:
- **Generate Password**:
  - Standard password (16 chars)
  - Passphrase (4 words)
  - Long password (32 chars)
  - Alphanumeric (12 chars - bank-compliant)
  - PIN code (6 digits)
  *(The generated password is automatically filled into the active input and copied to clipboard).*
- **Scan 2FA QR Code**:
  - *Scan from this image*: Right-click directly on any QR image on screen.
  - *Scan entire page*: Captures the current visible tab and decodes the QR code without opening the popup.
- **Autofill**:
  - *Fill saved account (by site)*: Automatically fills credentials matching the current domain.
  - *Fill latest 2FA OTP code*: Generates the current 6-digit TOTP code and fills it into the OTP field.

### 3. Managing 2FA / TOTP Tokens
1. Open the **2FA** tab in GenPass.
2. Add a new token via 3 options:
   - Click **+ Add** to paste a Base32 secret key or `otpauth://` link.
   - Click **Scan QR** to capture a QR code from the active tab.
   - Click **Upload QR** to decode a QR image file stored on your computer.
3. Click any 6-digit code to copy it, or click **Fill to web** to inject it directly into the active webpage.

### 4. History & Secure Notes
1. Open the **History** tab.
2. **Live Search**: Filter in real-time by platform name, username, URL, or notes keywords.
3. **Quick Actions**:
   - Click the password to copy it.
   - Click `👤 [Username]` to copy the login account.
   - Click `📝 [Note]` to copy secure notes.
4. **Edit**: Click the pencil icon to modify names, tags, accounts, or notes.

### 5. Payment Profiles (Google Pay, PayPal, Credit/Debit Cards)
1. Open the **Payments** tab.
2. Click **+ Add Profile**:
   - **Card Info**: Profile name, Cardholder name, Card number (auto-detected Visa, Mastercard, JCB, Amex, Napas), Expiration date (`MM/YY`), CVV/CVC code.
   - **Billing Address (Google Pay / PayPal)**: Email, Phone, Street address, City, State/Province, Zip/Postal code, Country.
   - **Secure Notes**: ATM PIN, bank branch.
3. **Security & Utilities**:
   - Card numbers are masked by default (`•••• •••• •••• 1234`). Click the eye icon to unmask or click to copy.
   - **Copy all**: Formats all billing details into one clean text block for rapid 1-click checkout pasting.
   - Auto-clears clipboard after 30 seconds.

### 6. Cookie Manager & Multi-Account Session Switcher
1. Open the **Cookies** tab (automatically recognizes current domain).
2. **Save Session**: Click **+ Save Session** and name it (e.g. `Admin Account`, `Guest Session`). GenPass snapshots all domain cookies locally.
3. **Switch Accounts**: Click **Switch to this session** to restore the snapshot and reload the page automatically.
4. **Export / Import JSON**:
   - Click **Export** to copy domain cookies in standard Cookie-Editor / EditThisCookie JSON format.
   - Click **Import** to paste JSON cookies and apply them instantly.
   - Click **Log out** to clear all domain cookies for immediate sign-out.

### 7. CSV Backup & Restore
1. In the **History** tab, click **Export** to save a standard CSV backup (`name,url,username,password,note`).
2. Click **Import** to restore credentials from an external CSV file (automatically deduplicates existing records).

---

## Project Structure

```text
GenPass/
├── manifest.json       # Manifest V3 extension configuration
├── popup.html          # Main popup UI document
├── popup.js            # UI controller, password engine, 2FA, payments, i18n
├── popup.css           # Styling with responsive light/dark theme
├── background.js       # Background service worker (Context menus, QR decoder, update checker)
├── content.js          # Webpage injection script (Autofill, badge injection, save prompt)
├── content.css         # Styling for in-page notification badges and toasts
├── jsqr.js             # Pure JavaScript offline QR decoder library (CSP-compliant)
├── wordlist.js         # EFF Diceware short wordlist (1,296 words)
├── vault.js            # Cryptographic vault core: Argon2id -> AES-256-GCM + AAD
├── vendor/hash-wasm.umd.js  # Vendored WebAssembly Argon2id library (MIT, offline)
├── tests/              # Cryptographic and integration test suites (Node.js 20+)
├── icons/              # Extension icons (16px, 48px, 128px)
├── .gitignore          # Git ignore configuration
├── README.md           # Vietnamese documentation
└── README_EN.md        # English documentation
```

---

## Permissions & Security Commitments

GenPass requests only the minimal permissions required for operation:
- `storage`: Store credentials, 2FA secrets, and settings locally.
- `clipboardWrite`: Write passwords and OTP codes to clipboard upon user request.
- `activeTab`: Capture visible tab and interact with form inputs on the active tab upon user request.
- `contextMenus`: Register right-click helper menus.
- `alarms`: Periodically trigger background update checks every 12 hours.
- `cookies`: Manage and switch session cookies per domain locally upon user request.
- `host_permissions`: Enable cross-origin QR image fetching when scanning images via context menu.

**Security Commitments**:
- 100% Open source, zero telemetry, no third-party tracking, zero advertisements.
- All credentials and 2FA secrets stay strictly on your local device.

---

## Security Architecture & Threat Model

### 1. Cryptographic Specifications
- **Key Derivation (KDF)**: Memory-hard Argon2id (`t=3`, `m=64 MiB`, `p=4`, 32-byte key output) via WebAssembly `hash-wasm` (MIT, vendored).
- **Encryption**: AES-256-GCM authenticated symmetric encryption with 128-bit authentication tags and random 12-byte IVs.
- **Integrity & Anti-Rollback**: Additional Authenticated Data (AAD) bound to the vault version envelope.
- **Session Key Protection**: Ephemeral session key stored in `chrome.storage.session`, automatically wiped when the browser or popup closes.
- **LevelDB Plaintext Shredding**: Overwrites prior plaintext entries with junk characters before removal to hinder physical disk recovery.

### 2. Threat Model & Antivirus Boundaries

#### Is security "absolute"?
In cybersecurity, **no system provides 100% absolute security**. Security is measured against realistic threat models and layers of Defense-in-Depth:
- **Zero Telemetry**: Operates entirely offline with zero network exfiltration vectors.
- **Brute-Force Rate Limiting**: Exponential backoff and lockout prevent automated PIN guessing attacks.
- **SSRF Protection**: URL sanitization prevents malicious websites from abusing the QR scanner against internal networks (`localhost`, `127.0.0.1`, LAN IPs).
- **Phishing Protection**: Autofill activates strictly when the active domain host matches the stored record, preventing credential leakage to fake replica domains.

#### Does GenPass protect against computer viruses?
**GenPass is a credential security tool, NOT an Antivirus or EDR solution.**
- **What GenPass protects against**: Protects passwords at rest from offline physical disk extraction when the browser is closed; prevents clipboard leakage via 30s auto-clear; defends against phishing domain spoofs.
- **What GenPass CANNOT protect against**: If your operating system is infected with kernel-level or user-level malware (Trojans, RATs, Keyloggers, or spyware), that malware shares your user privileges and can log keystrokes, capture screenshots, or inspect Chrome process memory while the vault is unlocked. Maintaining an up-to-date operating system and dedicated endpoint security software is essential.

---

## Support & Donations

GenPass is an independent, non-profit open-source project. If GenPass saves you time and enhances your digital security, you can support ongoing development:

- **Official GitHub Repository**: [github.com/lengoctuong2005/GenPass](https://github.com/lengoctuong2005/GenPass)
- **Direct Bank Transfer (VietQR Napas 24/7)**:
  - **Bank**: Techcombank
  - **Account Number**: `1005555555555`
  - **Account Holder**: `LE NGOC TUONG`
  - **Transfer Memo**: `GenPass Ung Ho`
  - **VietQR Image**: Available directly in the **Support** tab in the extension, or open: `https://img.vietqr.io/image/TCB-1005555555555-qr_only.png?amount=0&addInfo=GenPass%20Ung%20Ho&accountName=LE%20NGOC%20TUONG`

---

## Future Roadmap & Feature Proposals

1. **Emergency Recovery Kit**: Generate a printable one-page PDF with emergency recovery keys and instructions for physical safe storage.
2. **Offline Data Breach Audit**: Cross-reference saved passwords against known compromised password databases using HaveIBeenPwned's k-Anonymity SHA-1 prefix model without revealing the password.
3. **Encrypted Blob Backup (.genpass)**: Export the entire vault as a standalone encrypted binary file protected by a custom passphrase for secure offline multi-device sync.
4. **Auto-Lock on System Sleep / Lock**: Utilize the `chrome.idle` API to lock the vault immediately when your computer screen locks or goes to sleep.

---

## License

This software is released under the [MIT License](LICENSE).

Third-party dependencies are credited in [NOTICE](NOTICE):

| Component | File | License | Copyright Owner |
| :--- | :--- | :--- | :--- |
| jsQR 1.4.0 (QR decoder) | `jsqr.js` | Apache License 2.0 | Lazar Laszlo (cozmo) |
| EFF Diceware short wordlist | `wordlist.js` | CC BY (EFF) | Electronic Frontier Foundation |

All third-party trademarks and brand names belong to their respective owners and are used strictly for identification and compatibility purposes.
