const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fetch = require('node-fetch');

puppeteer.use(StealthPlugin());

const FIREBASE_API_KEY = process.env.FIREBASE_API_KEY;
const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID;
const WE_USERNAME = process.env.WE_USERNAME;
const WE_PASSWORD = process.env.WE_PASSWORD;

const MAX_RETRIES = 3;
const TIMEOUT = 180000; // 3 minutes total timeout

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForElement(page, selector, timeout = 10000) {
  try {
    await page.waitForSelector(selector, { timeout, visible: true });
    return true;
  } catch (e) {
    return false;
  }
}

async function harvestQuota() {
  console.log('🚀 GitHub Cloud Harvester starting...');
  
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: 'new',
      protocolTimeout: TIMEOUT,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-web-security',
        '--disable-features=IsolateOrigins,site-per-process'
      ]
    });

    const page = await browser.newPage();
    page.setDefaultTimeout(TIMEOUT);
    page.setDefaultNavigationTimeout(TIMEOUT);
    
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
      window.console.debug = () => {};
    });
    
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    
    console.log('1️⃣ Navigating to WE Egypt...');
    await page.goto('https://my.te.eg/echannel/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(2000);
    
    console.log('2️⃣ Filling username...');
    await page.waitForSelector('#login_loginid_input_01', { timeout: 15000 });
    await page.click('#login_loginid_input_01');
    await sleep(300);
    await page.type('#login_loginid_input_01', WE_USERNAME, { delay: 50 });
    await sleep(500);
    
    console.log('3️⃣ Selecting Internet (keyboard method)...');
    await page.keyboard.press('Tab');
    await sleep(500);
    await page.keyboard.type('Internet', { delay: 100 });
    await sleep(300);
    await page.keyboard.press('Enter');
    await sleep(1000);
    
    console.log('4️⃣ Filling password...');
    await page.keyboard.press('Tab');
    await sleep(300);
    await page.keyboard.type(WE_PASSWORD, { delay: 50 });
    await sleep(500);
    
    console.log('5️⃣ Submitting...');
    await page.keyboard.press('Enter');
    await sleep(8000);
    
    const url = page.url();
    console.log('  Current URL: ' + url);
    
    if (url.includes('#/login')) {
      throw new Error('Login failed - still on login page');
    }
    
    console.log('  ✓ Login successful');
    
    console.log('6️⃣ Extracting data...');
    await sleep(3000);
    
    const data = await page.evaluate(() => {
      const spans = Array.from(document.querySelectorAll('span, div'));
      let remaining = null, used = null, balance = null, plan = null;

      for (let i = 0; i < spans.length; i++) {
        const t = spans[i].innerText?.trim();
        if (!t) continue;
        if (t === 'Remaining' && spans[i-1]) remaining = parseFloat(spans[i-1].innerText);
        if (t === 'Used' && spans[i-1]) used = parseFloat(spans[i-1].innerText);
        if (t === 'Current Balance' && spans[i+1]) balance = parseFloat(spans[i+1].innerText);
        if (t && t.includes('GB') && t.toLowerCase().includes('speed')) plan = t;
      }

      const totalMatch = plan && plan.match(/(\d+)GB/);
      const total = totalMatch ? parseFloat(totalMatch[1]) : (remaining && used ? remaining + used : 0);

      return { remaining, used, total, balance, plan };
    });
    
    console.log('  Remaining: ' + data.remaining + ' GB');
    console.log('  Used: ' + data.used + ' GB');
    console.log('  Balance: ' + data.balance + ' EGP');
    
    if (!data.remaining && data.remaining !== 0) {
      throw new Error('Could not extract quota data');
    }
    
    const quotaData = {
      '104': {
        remaining: `${data.remaining.toFixed(2)} GB`,
        used: `${data.used.toFixed(2)} GB`,
        total: `${data.total.toFixed(2)} GB`,
        balance: `${data.balance.toFixed(2)} EGP`,
        planName: data.plan || 'Unknown',
        updatedAt: new Date().toISOString(),
        updatedBy: 'GitHub Cloud Harvester ⚡',
        status: 'success'
      },
      lastUpdate: new Date().toISOString()
    };
    
    console.log('7️⃣ Writing to Firestore...');
    
    const firestoreUrl = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/quota_latest/current?key=${FIREBASE_API_KEY}`;
    
    const response = await fetch(firestoreUrl, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fields: {
          '104': {
            mapValue: {
              fields: {
                remaining: { stringValue: quotaData['104'].remaining },
                used: { stringValue: quotaData['104'].used },
                total: { stringValue: quotaData['104'].total },
                balance: { stringValue: quotaData['104'].balance },
                planName: { stringValue: quotaData['104'].planName },
                updatedAt: { stringValue: quotaData['104'].updatedAt },
                updatedBy: { stringValue: quotaData['104'].updatedBy },
                status: { stringValue: quotaData['104'].status }
              }
            }
          },
          lastUpdate: { stringValue: quotaData.lastUpdate }
        }
      })
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Firestore write failed: ${response.status} - ${errorText}`);
    }
    
    console.log('✅ SUCCESS! Data updated in Firestore');
    
  } catch (error) {
    console.error('❌ ERROR:', error.message);
    throw error;
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

// Main execution with retry
async function main() {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      console.log(`\n=== Attempt ${attempt}/${MAX_RETRIES} ===`);
      await harvestQuota();
      console.log('\n✅ Harvester completed successfully!');
      process.exit(0);
    } catch (error) {
      console.error(`\n❌ Attempt ${attempt} failed: ${error.message}`);
      if (attempt < MAX_RETRIES) {
        console.log(`Retrying in 10 seconds...`);
        await sleep(10000);
      } else {
        console.error('\n❌ All attempts failed. Exiting.');
        process.exit(1);
      }
    }
  }
}

main();
