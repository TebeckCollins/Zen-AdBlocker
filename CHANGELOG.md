# Changelog

## [1.0.1] - 2026-02-06

### Added
- SVG icon asset for extension branding
- Enhanced error handling and logging across all scripts
- Dynamic badge color (green when active, gray when paused)
- Better allowlist UI feedback (prevents duplicate whitelist entries)

### Changed
- **Content script optimization**: Removed redundant DOM selector-based blocking
  - Primary ad blocking now fully delegated to Declarative Net Request rules
  - Content script now focuses only on cleanup tasks (broken iframes)
  - Significantly reduced CPU overhead and DOM thrashing
  
- **Expanded filter lists** for better coverage:
  - Added EasyList (main ad list) - comprehensive global ad network list
  - Upgraded from EasyPrivacy tracking servers to full EasyPrivacy list
  - Kept Adservers list for additional coverage
  - Now covers ~25,000+ rules across major ad networks and trackers

- Improved popup.js with:
  - Try-catch error handling for all Chrome API calls
  - Runtime error checking for storage and messaging operations
  - Better user feedback for whitelist operations

- Enhanced background.js with:
  - Error handling for message processing
  - Better memory management logging

### Fixed
- Icon asset reference in manifest.json (was missing)
- Content script performance issues from aggressive DOM mutation observation
- Potential race conditions in popup initialization

### Improved
- Code documentation with clearer comments
- Overall extension reliability and stability

## [1.0.0] - Initial Release
- Core ad blocking with Declarative Net Request
- Content script domain blocking
- Per-tab ad counter with badge display
- Site whitelist/allowlist functionality
- Toggle to enable/disable extension
