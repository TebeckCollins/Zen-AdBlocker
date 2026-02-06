# Zen AdBlocker

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
git clone https://github.com/your-username/Zen-AdBlocker.git
```
2. Go to `chrome://extensions` in your browser
3. Enable "Developer mode"
4. Click "Load unpacked" and select the project folder

## Building Rules (Optional)
To update the filter rules from EasyList/EasyPrivacy:
```bash
npm install
# Zen AdBlocker

A lightweight, privacy-focused Chrome extension that blocks ads and trackers using modern Declarative Net Request (DNR) rules and smart DOM cleanup.

## Features

- Modern Manifest V3: fast, secure, and future-proof
- EasyList + EasyPrivacy: blocks ads and trackers using popular filter lists
- Dynamic badge counter: see how many ads/trackers are blocked per tab
- One-click enable/disable: toggle protection from the popup
- Site allowlist: trust sites with a single click
- Ad redirect prevention: blocks ad links that try to hijack navigation
- No user data collection

## Installation

1. Clone your repository locally (replace with your GitHub repo URL):

```bash
git clone https://github.com/your-username/Zen-AdBlocker.git
```

2. Open `chrome://extensions` in Chrome
3. Enable **Developer mode**
4. Click **Load unpacked** and select this project folder

## Build filter rules (optional)

To regenerate `rules.json` from upstream filter lists:

```bash
npm install
node build-rules.js
```

This downloads lists and converts them to Declarative Net Request rules.

## Development

- Files of interest:
  - `manifest.json` — extension manifest
  - `background.js` — service worker (badge, messaging)
  - `content.js` — DOM cleanup, ad-redirect prevention
  - `popup.html` / `popup.js` — UI
  - `build-rules.js` — fetch & convert filter lists

## Contributing

Contributions welcome. Please open an issue before large changes.

## License

MIT

---

Zen AdBlocker — fast, open, and privacy-first ad blocking.
