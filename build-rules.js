const fs = require('fs');
const { convertFilter } = require('@eyeo/abp2dnr');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

// Proven, stable filter sources with working URLs
// Using official CDN mirrors that are maintained
const LISTS = [
    { name: 'EasyList (Ads)', url: 'https://easylist-downloads.adblockplus.org/easylist.txt' },
    { name: 'EasyPrivacy (Tracking)', url: 'https://easylist-downloads.adblockplus.org/easyprivacy.txt' }
];

const OUTPUT_FILE = 'rules.json';
const MAX_TOTAL_RULES = 29900; // Chrome DNR limit
const MAX_RULES_PER_LIST = 15000; // Distribute quota fairly

// ... (keep your top imports and constants)
async function buildMergedRules() {
    console.log("🚀 Starting Merged Build for Banners, Ads, and Trackers...");

    let dnrRules = [];
    let nextId = 1;

    for (const list of LISTS) {
        console.log(`📡 Fetching ${list.name}...`);
        try {
            const response = await fetch(list.url);
            const text = await response.text();
            const lines = text.split('\n');
            let listCount = 0;

            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed || trimmed.startsWith('!') || trimmed.startsWith('[')) continue;

                try {
                    const converted = await convertFilter(trimmed);
                    if (converted && converted.length > 0) {
                        for (const rule of converted) {
                            if (nextId > MAX_TOTAL_RULES || listCount >= MAX_RULES_PER_LIST) break;

                            // BANNER AD OPTIMIZATION:
                            // Ensure the rule applies to image and object types if not specified
                            if (!rule.condition.resourceTypes) {
                                rule.condition.resourceTypes = ['image', 'object', 'sub_frame', 'script'];
                            }

                            rule.id = nextId++;
                            dnrRules.push(rule);
                            listCount++;
                        }
                    }
                } catch (e) { continue; }

                if (nextId > MAX_TOTAL_RULES || listCount >= MAX_RULES_PER_LIST) break;
            }
            console.log(`✅ Added ${listCount} rules from ${list.name}.`);
        } catch (error) {
            console.error(`❌ Error fetching ${list.name}:`, error.message);
        }
        if (nextId > MAX_TOTAL_RULES) break;
    }

    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(dnrRules, null, 2));
    console.log(`\n🎉 DONE! Total rules: ${dnrRules.length}`);
}

buildMergedRules();