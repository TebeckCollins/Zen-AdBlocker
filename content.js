// Content script for cleanup of dynamically-injected content, broken iframes, and ad redirects
// Primary ad blocking is handled by Declarative Net Request (DNR) rules
// This script respects the current enabled/disabled state and listens for changes

let isExtensionActive = false;
let isWhitelisted = false;
let _thornObserver = null;
let _thornClickListener = null;
let _processingScheduled = false;
const PROCESS_DEBOUNCE_MS = 700;
const STYLE_ID = 'zen-adblocker-style';

// Initialize state from storage
function initializeState() {
    chrome.storage.local.get(['enabled', 'allowlist'], (data) => {
        isExtensionActive = data.enabled !== false; // Default to true
        isWhitelisted = (data.allowlist || []).includes(window.location.hostname);
        
        console.log(`🛡️ Thorn content script initialized - Enabled: ${isExtensionActive}, Whitelisted: ${isWhitelisted}`);
        
        if (isExtensionActive && !isWhitelisted) {
            startShield();
        } else {
            stopShield();
        }
    });
}

// Listen for storage changes (when user toggles extension on/off)
chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local') {
        if (changes.enabled) {
            isExtensionActive = changes.enabled.newValue !== false;
            console.log(`🔄 Extension toggled ${isExtensionActive ? 'ON' : 'OFF'}`);
            if (isExtensionActive && !isWhitelisted) {
                startShield();
            } else {
                stopShield();
            }
        }
        if (changes.allowlist) {
            isWhitelisted = (changes.allowlist.newValue || []).includes(window.location.hostname);
            console.log(`🔄 Whitelist updated - This site whitelisted: ${isWhitelisted}`);
        }
    }
});

// Initialize on first load
initializeState();

function startShield() {
    if (!isExtensionActive || isWhitelisted) return;
    if (_thornObserver) return; // already started
    // Prevent ads from redirecting the page
    const preventAdRedirects = () => {
        // Attach a namespaced listener (saved to remove later)
        if (_thornClickListener) return;
        _thornClickListener = function (e) {
            const target = e.target && e.target.closest && e.target.closest('a, button, [onclick]');
            if (!target) return;

            // Check if click target is likely an ad
            const href = target.getAttribute('href') || '';
            const onclick = target.getAttribute('onclick') || '';
            const classList = target.className || '';

            const isLikelyAd = /ad|ads|advertisement|click|doubleclick|googleadservices|outbrain|taboola/i.test(
                href + classList + onclick
            );

            if (isLikelyAd && href && !href.startsWith(window.location.origin)) {
                e.preventDefault();
                e.stopPropagation();
                console.log('🛡️ Blocked ad redirect to:', href);
            }
        };
        document.addEventListener('click', _thornClickListener, true);
    };

    // Hide broken/empty iframes and track count
    const removeEmptyIframes = () => {
        let count = 0;
        try {
            document.querySelectorAll('iframe').forEach(iframe => {
                try {
                    if (( !iframe.src || iframe.src === 'about:blank' ) && iframe.dataset && iframe.dataset.thornBlocked !== '1') {
                        iframe.style.display = 'none';
                        iframe.dataset.thornBlocked = '1';
                        count++;
                    }
                } catch (inner) { /* ignore cross-origin */ }
            });
            if (count > 0) {
                reportBlockedContent(count, 'iframes');
            }
        } catch (e) {
            // Silently ignore errors from cross-origin restrictions
        }
    };

    // Track ad containers that exist but are empty (blocked by DNR)
    const trackBlockedAdContainers = () => {
        let count = 0;
        const adSelectors = [
            '.adsbygoogle',
            '[id^="google_ads_"]',
            '.ad-container',
            '.ad-slot',
            '.advertisement',
            '[class*="ad-space"]',
            '[id*="ad-"]',
            '.ad',
            '.ads',
            '.sponsored',
            '.sponsored-content',
            '.promoted',
            '[data-ad]',
            '[data-adsense]',
            'iframe[id^="google_ads_frame"]',
            'embed[type="application/x-shockwave-flash"]',
            'object[classid]',
            'img[src*="doubleclick.net"]',
            'img[src*="ad-delivery"]',
            'img[src*="doubleclick"]',
            'img[src*="criteo"]',
            'img[src*="gumgum"]',
            '.taboola-ad',
            '.outbrain-ad',
            '.banner', '.banner-ad', '.header-banner', '.top-banner',
            '.sidebar-ads', '.side-ads', '.right-sidebar',
            '.leaderboard', '.skyscraper',
            '[id*="banner"]', '[class*="banner"]',
            'img[src*="banner"]',
            'img[src$=".gif"]', 'img[src$=".swf"]'
        ];

        try {
            document.querySelectorAll(adSelectors.join(', ')).forEach(element => {
                try {
                    // Skip elements already reported
                    if (element.dataset && element.dataset.thornBlocked === '1') return;

                    const style = window.getComputedStyle(element);
                    const isEmpty = (element.offsetHeight === 0) || (style && style.display === 'none' );
                    if (isEmpty) {
                        element.dataset.thornBlocked = '1';
                        count++;
                    }
                } catch (inner) { /* ignore cross-origin or render errors */ }
            });
            if (count > 0) {
                reportBlockedContent(count, 'containers');
            }
        } catch (e) {
            // Silently ignore
        }
    };

    // Inject lightweight CSS rules to hide common ad containers early
    const injectHideStyles = () => {
        if (document.getElementById(STYLE_ID)) return;
        try {
            const style = document.createElement('style');
            style.id = STYLE_ID;
            const selectors = [
                '.ad', '.ads', '.adsbygoogle', '.ad-container', '.ad-slot', '.advertisement',
                '.sponsored', '.sponsored-content', '.promoted', '[data-ad]', '[data-adsense]',
                '[id^="google_ads_"]', '[class*="ad-"]', '[class*="-ad"]', '[id*="-ad"]',
                '.banner', '.banner-ad', '[id*="banner"]', '[class*="banner"]',
                '.leaderboard', '.skyscraper', '.sidebar-ads', '.side-ads'
            ];
            style.textContent = selectors.join(', ') + ' { display: none !important; visibility: hidden !important; width: 0 !important; height: 0 !important; }';
            (document.head || document.documentElement).appendChild(style);
        } catch (e) {
            // ignore
        }
    };

    const removeHideStyles = () => {
        try {
            const el = document.getElementById(STYLE_ID);
            if (el && el.parentNode) el.parentNode.removeChild(el);
        } catch (e) { /* ignore */ }
    };

    // Report blocked content to background script
    const reportBlockedContent = (count, type) => {
        try {
            console.log(`📊 Reporting ${count} blocked ${type}`);
            chrome.runtime.sendMessage({
                action: "updateCount",
                count: count,
                type: type
            });
        } catch (error) {
            // Extension context may have been invalidated
            console.error('❌ Error reporting blocked content:', error);
        }
    };

    // Process both iframe and ad container checks together
    const processDOM = () => {
        if (!isExtensionActive || isWhitelisted) return;
        
        // Handle lazy-loaded banner images
        try {
            document.querySelectorAll('img[data-src], img[loading="lazy"]').forEach(img => {
                try {
                    if (img.dataset && img.dataset.thornBlocked === '1') return;
                    const srcStr = ((img.src || '') + (img.dataset.src || '')).toLowerCase();
                    if (/ad|banner|doubleclick|criteo|gumgum|taboola|outbrain/.test(srcStr)) {
                        img.style.display = 'none';
                        img.dataset.thornBlocked = '1';
                    }
                } catch (inner) { /* ignore */ }
            });
        } catch (e) { /* ignore */ }
        removeEmptyIframes();
        trackBlockedAdContainers();
    };

    const scheduleProcessing = () => {
        if (_processingScheduled) return;
        _processingScheduled = true;
        setTimeout(() => {
            _processingScheduled = false;
            processDOM();
        }, PROCESS_DEBOUNCE_MS);
    };

    // Prevent ad redirects on page load
    preventAdRedirects();

    // Initial cleanup and observe for dynamically added content
    // Inject CSS to catch cosmetic elements early
    injectHideStyles();
    processDOM();
    _thornObserver = new MutationObserver(scheduleProcessing);
    _thornObserver.observe(document.documentElement, { childList: true, subtree: true });
}

function stopShield() {
    // Disconnect observer and remove click listener
    try {
        if (_thornObserver) {
            _thornObserver.disconnect();
            _thornObserver = null;
        }
        if (_thornClickListener) {
            document.removeEventListener('click', _thornClickListener, true);
            _thornClickListener = null;
        }
        // Remove injected CSS
        removeHideStyles();
    } catch (e) {
        console.error('❌ Error stopping shield:', e);
    }
}