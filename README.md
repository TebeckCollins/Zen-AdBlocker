# Thorn AdBlocker

A lightweight, privacy-focused Chrome extension that blocks ads and trackers using modern Declarative Net Request (DNR) rules and smart DOM cleanup.

## Features
- **Modern Manifest V3**: Fast, secure, and future-proof
- **EasyList + EasyPrivacy**: Blocks ads and trackers using the most popular filter lists
- **Dynamic Badge Counter**: See how many ads/trackers are blocked per tab
- **One-click Enable/Disable**: Instantly toggle protection from the popup
- **Site Allowlist**: Trust your favorite sites with a single click
- **Ad Redirect Prevention**: Stops ad links from hijacking your browsing
- **No User Data Collection**: 100% privacy-respecting

## Installation
1. Download or clone this repository:
   ```bash
   git clone https://github.com/your-username/thorn-adblocker.git
   ```
2. Go to `chrome://extensions` in your browser
3. Enable "Developer mode"
4. Click "Load unpacked" and select the project folder

## Building Rules (Optional)
To update the filter rules from EasyList/EasyPrivacy:
```bash
npm install
node build-rules.js
```
This will fetch the latest lists and generate `rules.json`.

## Development
- All extension code is in the root directory
- Main files:
  - `manifest.json` — Chrome extension manifest
  - `background.js` — Service worker for badge, messaging, and rule management
  - `content.js` — DOM cleanup and ad redirect prevention
  - `popup.html` / `popup.js` — User interface
  - `build-rules.js` — Script to fetch and convert filter lists

## Contributing
Pull requests are welcome! Please open an issue first to discuss major changes.

## License
MIT

---

**Thorn AdBlocker** — Fast, open, and privacy-first ad blocking for everyone.
