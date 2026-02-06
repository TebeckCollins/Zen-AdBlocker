// Content script for cleanup of dynamically-injected content, broken iframes, and ad redirects
// Primary ad blocking is handled by Declarative Net Request (DNR) rules
// This script respects the current enabled/disabled state and listens for changes

let isExtensionActive = false;
let isWhitelisted = false;
let _thornObserver = null;
let _thornClickListener = null;
let _thornTrackerObserver = null;
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

    // BLOCK TRACKING SCRIPTS (Google Analytics, Hotjar, Yandex)
    const blockTrackers = () => {
        // Block Google Analytics (ga, gtag, googletag, dataLayer)
        try {
            Object.defineProperty(window, 'ga', { value: function() {}, writable: false });
            Object.defineProperty(window, 'gtag', { value: function() {}, writable: false });
            Object.defineProperty(window, 'googletag', { value: {}, writable: false });
            Object.defineProperty(window, 'dataLayer', { value: [], writable: false });
        } catch (e) {}
        // Block Hotjar (hj, hjSettings)
        try {
            Object.defineProperty(window, 'hj', { value: function() {}, writable: false });
            Object.defineProperty(window, 'hjSettings', { value: {}, writable: false });
        } catch (e) {}
        // Block Yandex Metrica (ym, Ya, yandex_metrika_callbacks)
        try {
            Object.defineProperty(window, 'ym', { value: function() {}, writable: false });
            Object.defineProperty(window, 'Ya', { value: {}, writable: false });
            Object.defineProperty(window, 'yandex_metrika_callbacks', { value: [], writable: false });
        } catch (e) {}

        // Remove tracker script tags as soon as possible
        const trackerScriptPatterns = [
            /google-analytics\.com/i,
            /gtag\/js/i,
            /googletagmanager\.com/i,
            /hotjar\.com/i,
            /static\.hotjar\.com/i,
            /yandex.*\.js/i,
            /mc\.yandex\.ru/i
        ];
        const observer = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                for (const node of mutation.addedNodes) {
                    if (node.tagName === 'SCRIPT' && node.src) {
                        for (const pat of trackerScriptPatterns) {
                            if (pat.test(node.src)) {
                                node.type = 'javascript/blocked';
                                node.parentNode && node.parentNode.removeChild(node);
                                console.log('🛡️ Blocked tracker script:', node.src);
                                break;
                            }
                        }
                    }
                }
            }
        });
        observer.observe(document.documentElement || document, { childList: true, subtree: true });

        // Save reference so we can disconnect later
        _thornTrackerObserver = observer;

        // Remove any existing tracker scripts
        document.querySelectorAll('script[src]').forEach(node => {
            for (const pat of trackerScriptPatterns) {
                if (pat.test(node.src)) {
                    node.type = 'javascript/blocked';
                    node.parentNode && node.parentNode.removeChild(node);
                    console.log('🛡️ Blocked tracker script:', node.src);
                    break;
                }
            }
        });
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
            '.taboola-ad',
            '.outbrain-ad'
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

    // Hide banner images and their containers
    const hideBannerImages = () => {
        let count = 0;
        try {
            // Find all images with /banners/, /ads/, /ad/ paths
            document.querySelectorAll('img[src*="/banners/"], img[src*="/ads/"], img[src*="/ad/"]').forEach(img => {
                try {
                    // Skip if already processed
                    if (img.dataset && img.dataset.thornBlocked === '1') return;
                    
                    // Hide the image itself
                    img.style.display = 'none';
                    img.style.visibility = 'hidden';
                    img.dataset.thornBlocked = '1';
                    count++;
                    
                    // Also hide parent containers (div, section, aside with ad-related classes)
                    let parent = img.closest('.include, [class*="ad-"], [id*="ad-"], [data-ad], .promo, .sponsor, .promoted');
                    if (parent && !parent.dataset.thornBlocked) {
                        parent.style.display = 'none';
                        parent.style.visibility = 'hidden';
                        parent.dataset.thornBlocked = '1';
                    }
                } catch (inner) { /* ignore */ }
            });
            if (count > 0) {
                reportBlockedContent(count, 'banner-images');
            }
        } catch (e) {
            // Silently ignore
        }
    };

    // Specific selectors for known ad networks and containers ONLY
    // Avoid broad patterns like [id*="ad"] which catch legitimate content
    const bannerSelectors = [

        // Banner file paths - specific targeting for ad image files
        'img[src*="/banners/"][alt=""]',     // Images in /banners/ path with empty alt (common ad indicator)
        '.include img[src*="/banners/"]',    // Images in .include divs with /banners/ path
        'img[src*="/ads/"][alt=""]',         // Images in /ads/ path with empty alt
        'img[src*="/ad/"][alt=""]',          // Images in /ad/ path with empty alt
        
        // Data attributes - very specific only
        'div[data-ad-type], section[data-ad-type], aside[data-ad-type]',
        '[data-advertisement], [data-adunit]',
        // Iframes and images - ONLY specific ad networks (DNR rules handle file blocking)
        // Avoid broad patterns like img[src*="ad"] which break legitimate content like reddit.com thumbnails
        'iframe[id^="google_ads_frame" i]',
        'iframe[src*="googlesyndication.com"]',
        'iframe[src*="doubleclick.net"]',
        // Misc - specific ad network IDs only
        'div[id^="google_ads" i]',
        'div[id^="dfp-ad" i]',
        'div[id^="gpt-ad" i]',
        'div[id^="yandex_ad" i]',
        'div[id^="adfox_" i]',
        'div[id^="adngin-" i]',
        'div[id^="adform-" i]',
        'div[id^="adblade-" i]',
        'div[id^="adzerk-" i]',
        'div[id^="adition-" i]',
        'div[id^="adman-" i]',
        'div[id^="admax-" i]',
        'div[id^="admedia-" i]',
        'div[id^="admeta-" i]',
        'div[id^="adnxs-" i]',
        'div[id^="adroll-" i]',
        'div[id^="adsense-" i]',
        'div[id^="adserver-" i]',
        'div[id^="adtech-" i]',
        'div[id^="adtelligent-" i]',
        'div[id^="adthrive-" i]',
        'div[id^="advert-" i]',
        'div[id^="advertise-" i]',
        'div[id^="advertising-" i]',
        'div[id^="advertorial-" i]',
        'div[id^="advertpro-" i]',
        'div[id^="adview-" i]',
        'div[id^="adwords-" i]',
        'div[id^="adx-" i]',
        'div[id^="ads-" i]',
        'div[id^="adslot-" i]',
        'div[id^="adunit-" i]',
        'div[id^="adzone-" i]',
        'div[id^="sponsor-" i]',
        'div[id^="sponsored-" i]',
        'div[id^="promo-" i]',
        'div[id^="promotion-" i]',
        'div[id^="promobox-" i]',
        'div[id^="promobanner-" i]',
    ];

    // CSS to inject for early hiding of banner ads (expanded for robustness)
    const bannerHideCSS = `
${bannerSelectors.join(",\n")} {
    display: none !important;
    visibility: hidden !important;
    opacity: 0 !important;
    max-height: 1px !important;
    max-width: 1px !important;
    min-height: 0 !important;
    min-width: 0 !important;
    pointer-events: none !important;
    z-index: -9999 !important;
    background: none !important;
    border: none !important;
    box-shadow: none !important;
    margin: 0 !important;
    padding: 0 !important;
    font-size: 0 !important;
    line-height: 0 !important;
    overflow: hidden !important;
    filter: none !important;
    transition: none !important;
}
iframe[width][height][src*="googlesyndication.com"],
iframe[width][height][src*="doubleclick.net"] {
    display: none !important;
    visibility: hidden !important;
    opacity: 0 !important;
    pointer-events: none !important;
    z-index: -9999 !important;
}
/* Remove overly broad img selectors to avoid blocking legitimate images */
/* Let DNR rules.json handle file-level blocking instead */
`;

    const injectHideStyles = () => {
        if (document.getElementById(STYLE_ID)) return;
        try {
            const style = document.createElement('style');
            style.id = STYLE_ID;
            style.textContent = bannerHideCSS;
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
        removeEmptyIframes();
        hideBannerImages();
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
    // Block analytics/tracker script execution
    blockTrackers();

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
        if (_thornTrackerObserver) {
            try { _thornTrackerObserver.disconnect(); } catch (e) {}
            _thornTrackerObserver = null;
        }
        // Remove injected CSS
        removeHideStyles();
    } catch (e) {
        console.error('❌ Error stopping shield:', e);
    }
}