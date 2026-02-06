document.addEventListener('DOMContentLoaded', async function() {
    const toggle = document.getElementById('toggleBlocker');
    const countDisplay = document.getElementById('count');
    const whitelistBtn = document.getElementById('whitelistBtn');
    const statusBox = document.getElementById('statusBox');
    const statusTitle = document.getElementById('statusTitle');
    const vpnBtn = document.getElementById('vpnLink');

    try {
        // Get the current active tab
        let [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

        // Ask background.js for this specific tab's count
        chrome.runtime.sendMessage({ action: "getTabCount", tabId: tab.id }, (response) => {
            if (chrome.runtime.lastError) {
                console.error('Error getting tab count:', chrome.runtime.lastError);
                countDisplay.textContent = 0;
            } else {
                countDisplay.textContent = response ? (response.count || 0) : 0;
            }
        });

        // Load the global 'enabled' state to set the toggle and colors
        chrome.storage.local.get(['enabled'], (data) => {
            if (chrome.runtime.lastError) {
                console.error('Error loading settings:', chrome.runtime.lastError);
                return;
            }
            const isEnabled = data.enabled !== false;
            toggle.checked = isEnabled;
            updateUI(isEnabled);
        });
    } catch (error) {
        console.error('Popup initialization error:', error);
    }

    // Toggle Switch Logic
    toggle.addEventListener('change', () => {
        const isEnabled = toggle.checked;
        try {
            chrome.declarativeNetRequest.updateEnabledRulesets({
                [isEnabled ? 'enableRulesetIds' : 'disableRulesetIds']: ['ruleset_1']
            });
            chrome.storage.local.set({ enabled: isEnabled }, () => {
                if (chrome.runtime.lastError) {
                    console.error('Error saving state:', chrome.runtime.lastError);
                }
                updateUI(isEnabled);
            });
        } catch (error) {
            console.error('Error toggling blocker:', error);
        }
    });

    // Whitelist Logic
    whitelistBtn.addEventListener('click', async () => {
        try {
            let [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            let hostname = new URL(tab.url).hostname;
            chrome.storage.local.get(['allowlist'], (data) => {
                if (chrome.runtime.lastError) {
                    console.error('Error reading allowlist:', chrome.runtime.lastError);
                    return;
                }
                let list = data.allowlist || [];
                if (!list.includes(hostname)) {
                    list.push(hostname);
                    chrome.storage.local.set({ allowlist: list }, () => {
                        if (chrome.runtime.lastError) {
                            console.error('Error saving allowlist:', chrome.runtime.lastError);
                        } else {
                            alert(`${hostname} is now trusted.`);
                            chrome.tabs.reload(tab.id);
                        }
                    });
                } else {
                    alert(`${hostname} is already trusted.`);
                }
            });
        } catch (error) {
            console.error('Error adding to whitelist:', error);
        }
    });

    // Affiliate Link Logic
    vpnBtn.addEventListener('click', (e) => {
        e.preventDefault();
        chrome.tabs.create({ url: 'https://YOUR_AFFILIATE_LINK_HERE' });
    });

    // Update UI with dynamic colors and badge color based on state
    function updateUI(enabled) {
        if (enabled) {
            statusBox.style.background = "#d4edda";
            statusBox.style.color = "#155724";
            statusTitle.textContent = "Shield is Active";
            chrome.action.setBadgeBackgroundColor({ color: '#2ecc71' }); // Green
        } else {
            statusBox.style.background = "#f8d7da";
            statusBox.style.color = "#721c24";
            statusTitle.textContent = "Shield is Paused";
            chrome.action.setBadgeBackgroundColor({ color: '#95a5a6' }); // Gray
        }
    }
});