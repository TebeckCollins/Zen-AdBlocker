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

    // Expanded and robust selectors for banner ads and common ad containers
    const bannerSelectors = [
        '[id*="ad" i]:not([id*="read"]):not([id*="head"]):not([id*="load"]):not([id*="road"]):not([id*="shadow"]):not([id*="pad"]):not([id*="mad"]):not([id*="bad"]):not([id*="glad"]):not([id*="rad"]):not([id*="lad"]):not([id*="cad"]):not([id*="dead"]):not([id*="lead"]):not([id*="bread"]):not([id*="thread"]):not([id*="spread"]):not([id*="ahead"]):not([id*="mead"]):not([id*="stead"]):not([id*="plead"]):not([id*="bead"]):not([id*="dread"]):not([id*="stead"]):not([id*="tread"]):not([id*="widespread"]):not([id*="instead"]):not([id*="misread"]):not([id*="mislead"]):not([id*="overhead"])',
        '[class*="ad" i]:not([class*="read"]):not([class*="head"]):not([class*="load"]):not([class*="road"]):not([class*="shadow"]):not([class*="pad"]):not([class*="mad"]):not([class*="bad"]):not([class*="glad"]):not([class*="rad"]):not([class*="lad"]):not([class*="cad"]):not([class*="dead"]):not([class*="lead"]):not([class*="bread"]):not([class*="thread"]):not([class*="spread"]):not([class*="ahead"]):not([class*="mead"]):not([class*="stead"]):not([class*="plead"]):not([class*="bead"]):not([class*="dread"]):not([class*="stead"]):not([class*="tread"]):not([class*="widespread"]):not([class*="instead"]):not([class*="misread"]):not([class*="mislead"]):not([class*="overhead"])',
        '[id*="banner" i]',
        '[class*="banner" i]',
        '[id*="adbanner" i]',
        '[class*="adbanner" i]',
        '[id*="ad-bar" i]',
        '[class*="ad-bar" i]',
        '[id*="adbox" i]',
        '[class*="adbox" i]',
        '[id*="adunit" i]',
        '[class*="adunit" i]',
        '[id*="adcontainer" i]',
        '[class*="adcontainer" i]',
        '[id*="adframe" i]',
        '[class*="adframe" i]',
        '[id*="adspace" i]',
        '[class*="adspace" i]',
        '[id*="ad-slot" i]',
        '[class*="ad-slot" i]',
        '[id*="ad-placement" i]',
        '[class*="ad-placement" i]',
        '[id*="leaderboard" i]',
        '[class*="leaderboard" i]',
        '[id*="top-banner" i]',
        '[class*="top-banner" i]',
        '[id*="bottom-banner" i]',
        '[class*="bottom-banner" i]',
        '[id*="sponsor" i]',
        '[class*="sponsor" i]',
        '[id*="advert" i]',
        '[class*="advert" i]',
        '[id*="adsense" i]',
        '[class*="adsense" i]',
        '[id*="adheader" i]',
        '[class*="adheader" i]',
        '[id*="adfooter" i]',
        '[class*="adfooter" i]',
        '[id*="adimg" i]',
        '[class*="adimg" i]',
        '[id*="adpic" i]',
        '[class*="adpic" i]',
        '[id*="adimage" i]',
        '[class*="adimage" i]',
        '[id*="adrow" i]',
        '[class*="adrow" i]',
        '[id*="adcol" i]',
        '[class*="adcol" i]',
        '[id*="adcell" i]',
        '[class*="adcell" i]',
        '[id*="adsection" i]',
        '[class*="adsection" i]',
        '[id*="adblocker" i]',
        '[class*="adblocker" i]',
        '[id*="adbar" i]',
        '[class*="adbar" i]',
        '[id*="adpanel" i]',
        '[class*="adpanel" i]',
        '[id*="adcontent" i]',
        '[class*="adcontent" i]',
        '[id*="admodule" i]',
        '[class*="admodule" i]',
        '[id*="adgroup" i]',
        '[class*="adgroup" i]',
        '[id*="aditem" i]',
        '[class*="aditem" i]',
        '[id*="adspot" i]',
        '[class*="adspot" i]',
        '[id*="adtag" i]',
        '[class*="adtag" i]',
        '[id*="sponsored" i]',
        '[class*="sponsored" i]',
        '[id*="promo" i]',
        '[class*="promo" i]',
        '[id*="promobox" i]',
        '[class*="promobox" i]',
        '[id*="promobanner" i]',
        '[class*="promobanner" i]',
        // Data attributes
        'div[data-ad], section[data-ad], aside[data-ad], [data-ad], [data-advertisement], [data-banner], [data-adunit]',
        // ARIA/role
        '[role="banner" i]',
        '[aria-label*="ad" i]',
        '[aria-label*="banner" i]',
        '[aria-label*="sponsor" i]',
        '[aria-label*="advert" i]',
        '[aria-label*="promotion" i]',
        '[aria-label*="promo" i]',
        '[aria-label*="ads" i]',
        '[aria-label*="advertisement" i]',
        '[aria-label*="sponsored" i]',
        '[aria-label*="sponsorship" i]',
        '[aria-label*="leaderboard" i]',
        '[aria-label*="top-banner" i]',
        '[aria-label*="bottom-banner" i]',
        '[aria-label*="adheader" i]',
        '[aria-label*="adfooter" i]',
        '[aria-label*="adimg" i]',
        '[aria-label*="adpic" i]',
        '[aria-label*="adimage" i]',
        '[aria-label*="adframe" i]',
        '[aria-label*="adblock" i]',
        '[aria-label*="adunit" i]',
        '[aria-label*="adrow" i]',
        '[aria-label*="adcol" i]',
        '[aria-label*="adcell" i]',
        '[aria-label*="adsection" i]',
        '[aria-label*="adblocker" i]',
        '[aria-label*="adbanner" i]',
        '[aria-label*="adbar" i]',
        '[aria-label*="adpanel" i]',
        '[aria-label*="adcontent" i]',
        '[aria-label*="admodule" i]',
        '[aria-label*="adgroup" i]',
        '[aria-label*="aditem" i]',
        '[aria-label*="adspot" i]',
        '[aria-label*="adtag" i]',
        '[aria-label*="promo" i]',
        '[aria-label*="promobox" i]',
        '[aria-label*="promobanner" i]',
        // Iframes and images
        'iframe[src*="ad" i]:not([src*="read"]):not([src*="head"]):not([src*="load"]):not([src*="road"]):not([src*="shadow"]):not([src*="pad"]):not([src*="mad"]):not([src*="bad"]):not([src*="glad"]):not([src*="rad"]):not([src*="lad"]):not([src*="cad"]):not([src*="dead"]):not([src*="lead"]):not([src*="bread"]):not([src*="thread"]):not([src*="spread"]):not([src*="ahead"]):not([src*="mead"]):not([src*="stead"]):not([src*="plead"]):not([src*="bead"]):not([src*="dread"]):not([src*="stead"]):not([src*="tread"]):not([src*="widespread"]):not([src*="instead"]):not([src*="misread"]):not([src*="mislead"]):not([src*="overhead"])',
        'img[src*="ad" i]:not([src*="read"]):not([src*="head"]):not([src*="load"]):not([src*="road"]):not([src*="shadow"]):not([src*="pad"]):not([src*="mad"]):not([src*="bad"]):not([src*="glad"]):not([src*="rad"]):not([src*="lad"]):not([src*="cad"]):not([src*="dead"]):not([src*="lead"]):not([src*="bread"]):not([src*="thread"]):not([src*="spread"]):not([src*="ahead"]):not([src*="mead"]):not([src*="stead"]):not([src*="plead"]):not([src*="bead"]):not([src*="dread"]):not([src*="stead"]):not([src*="tread"]):not([src*="widespread"]):not([src*="instead"]):not([src*="misread"]):not([src*="mislead"]):not([src*="overhead"])',
        // Common ad image file patterns
        'img[src$=".gif" i][src*="ad" i]',
        'img[src$=".jpg" i][src*="ad" i]',
        'img[src$=".png" i][src*="ad" i]',
        // Misc
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
        'div[id^="adzerk-" i]',
        'div[id^="adx-" i]',
        'div[id^="ads-" i]',
        'div[id^="adsense-" i]',
        'div[id^="adslot-" i]',
        'div[id^="adunit-" i]',
        'div[id^="adzone-" i]',
        'div[id^="sponsor-" i]',
        'div[id^="sponsored-" i]',
        'div[id^="promo-" i]',
        'div[id^="promotion-" i]',
        'div[id^="promobox-" i]',
        'div[id^="promobanner-" i]',
        // Ad containers with fixed/absolute position
        'div[style*="position:fixed" i][id*="ad" i]',
        'div[style*="position:absolute" i][id*="ad" i]',
        'div[style*="position:fixed" i][class*="ad" i]',
        'div[style*="position:absolute" i][class*="ad" i]',
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
iframe[width][height][src*="ad" i],
iframe[width][height][src*="banner" i] {
    display: none !important;
    visibility: hidden !important;
    opacity: 0 !important;
    pointer-events: none !important;
    z-index: -9999 !important;
}
img[src*="ad" i],
img[alt*="ad" i],
img[title*="ad" i],
img[src*="banner" i],
img[alt*="banner" i],
img[title*="banner" i] {
    display: none !important;
    visibility: hidden !important;
    opacity: 0 !important;
    pointer-events: none !important;
    z-index: -9999 !important;
}
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