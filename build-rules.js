const fs = require('fs');
const { convertFilter } = require('@eyeo/abp2dnr');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

// Comprehensive filter lists for effective ad and tracking blocking
// Expanded in 1.0.1 for better coverage across common ad networks
const LISTS = [
    { name: 'EasyList (Main)', url: 'https://raw.githubusercontent.com/easylist/easylist/master/easylist/easylist.txt' },
    { name: 'EasyPrivacy', url: 'https://raw.githubusercontent.com/easylist/easylist/master/easyprivacy/easyprivacy.txt' },
    { name: 'Adservers', url: 'https://raw.githubusercontent.com/easylist/easylist/master/easylist/easylist_adservers.txt' }
];

const OUTPUT_FILE = 'rules.json';
const MAX_TOTAL_RULES = 29900; // Leaving a small 100-rule buffer for safety

async function buildMergedRules() {
    console.log("🚀 Starting Merged Build (Comprehensive Ad + Privacy Filtering)...");

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
                            if (nextId <= MAX_TOTAL_RULES) {
                                rule.id = nextId++;
                                dnrRules.push(rule);
                                listCount++;
                            }
                        }
                    }
                } catch (e) { continue; }

                if (nextId > MAX_TOTAL_RULES) break;
            }
            console.log(`✅ Added ${listCount} rules from ${list.name}.`);
        } catch (error) {
            console.error(`❌ Error fetching ${list.name}:`, error.message);
        }

        if (nextId > MAX_TOTAL_RULES) {
            console.log("⚠️ Total rule limit reached. Skipping remaining lists/rules.");
            break;
        }
    }

    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(dnrRules, null, 2));
    console.log(`\n🎉 DONE! Total rules in rules.json: ${dnrRules.length}`);
}

buildMergedRules();