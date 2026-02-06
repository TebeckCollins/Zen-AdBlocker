let tabCounts = {};

console.log('🛡️ Thorn AdBlocker Service Worker started');

// Recent report cache to prevent duplicate rapid increments per tab
const _recentReports = {}; // tabId -> { type, count, ts }

// Listen for messages from content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    try {
        if (message.action === "updateCount" && sender.tab) {
            const tabId = sender.tab.id;
            const type = message.type || 'any';
            const now = Date.now();

            // Check for recent identical report (within 1500ms) to avoid duplicate bursts
            const prev = _recentReports[tabId];
            if (prev && prev.type === type && prev.count === message.count && (now - prev.ts) < 1500) {
                // Duplicate rapid report - ignore
                console.log(`⚠️ Ignored duplicate report for tab ${tabId} (${message.count} ${type})`);
                return;
            }

            if (!tabCounts[tabId]) tabCounts[tabId] = 0;
            tabCounts[tabId] += message.count;
            _recentReports[tabId] = { type, count: message.count, ts: now };

            console.log(`📊 Tab ${tabId} - Blocked ${message.count} ${type} (Total: ${tabCounts[tabId]})`);

            // Update the badge text on the extension icon
            chrome.action.setBadgeText({
                tabId: tabId,
                text: tabCounts[tabId].toString()
            });
            chrome.action.setBadgeBackgroundColor({ color: '#2ecc71' });
        }
    } catch (error) {
        console.error('❌ Error processing message:', error);
    }
});

// Clean up memory when a tab is closed or refreshed
chrome.tabs.onRemoved.addListener((tabId) => { 
    console.log(`🗑️ Cleaning up tab ${tabId}`);
    delete tabCounts[tabId]; 
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    try {
        if (changeInfo.status === 'loading') {
            console.log(`🔄 Tab ${tabId} refreshing - resetting count`);
            tabCounts[tabId] = 0;
            chrome.action.setBadgeText({ tabId: tabId, text: "" });
        }
    } catch (error) {
        console.error('❌ Error updating tab:', error);
    }
});

// Provide the count to the popup when requested
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    try {
        if (message.action === "getTabCount") {
            const count = tabCounts[message.tabId] || 0;
            console.log(`📈 Popup requested count for tab ${message.tabId}: ${count}`);
            sendResponse({ count: count });
        }
    } catch (error) {
        console.error('❌ Error getting tab count:', error);
        sendResponse({ count: 0 });
    }
    return true; // Keeps the communication channel open for async response
});

// Log all DNR stats when rules are enabled/disabled
chrome.declarativeNetRequest.onRuleMatchedDebug?.addListener?.((details) => {
    console.log(`🚫 DNR Rule matched - Domain: ${details.request.url}, Rule: ${details.ruleId}`);
});