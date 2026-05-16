const { chromium } = require('playwright-chromium');
const fetch = require('node-fetch');

const FIREBASE_API_KEY = process.env.FIREBASE_API_KEY;
const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID;
const WE_USERNAME = process.env.WE_USERNAME;
const WE_PASSWORD = process.env.WE_PASSWORD;

const MAX_RETRIES = 3;

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function randomDelay(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function harvestQuota() {
  console.log('🚀 Cloud Harvester starting...');
  
  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      viewport: { width: 1920, height: 1080 },
      locale: 'en-US',
      timezoneId: 'Africa/Cairo'
    });
    
    const page = await context.newPage();
    
    console.log('1️⃣ Navigating...');
    await page.goto('https://my.te.eg/echannel/', { waitUntil: 'networkidle', timeout: 60000 });
    await sleep(randomDelay(4000, 6000));
    
    console.log('2️⃣ Username...');
    await page.waitForSelector('#login_loginid_input_01', { timeout: 20000 });
    await page.click('#login_loginid_input_01');
    await sleep(randomDelay(300, 600));
    for (const char of WE_USERNAME) {
      await page.keyboard.type(char);
      await sleep(randomDelay(80, 150));
    }
    await sleep(randomDelay(800, 1200));
    
    console.log('3️⃣ Service type...');
    await page.keyboard.press('Tab');
    await sleep(randomDelay(700, 1000));
    await page.keyboard.type('Internet');
    await sleep(randomDelay(500, 800));
    await page.keyboard.press('Enter');
    await sleep(randomDelay(1500, 2000));
    
    console.log('4️⃣ Password...');
    await page.keyboard.press('Tab');
    await sleep(randomDelay(400, 700));
    for (const char of WE_PASSWORD) {
      await page.keyboard.type(char);
      await sleep(randomDelay(80, 150));
    }
    await sleep(randomDelay(1000, 1500));
    
    console.log('5️⃣ Submit...');
    await page.keyboard.press('Enter');
    await sleep(randomDelay(15000, 18000));
    
    const url = page.url();
    console.log('  URL:', url);
    
    if (url.includes('#/login')) {
      const screenshot = await page.screenshot({ fullPage: false });
      console.log('  Screenshot size:', screenshot.length, 'bytes');
      throw new Error('Login failed');
    }
    
    console.log('6️⃣ Extracting...');
    await sleep(randomDelay(5000, 7000));
    
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
    
    console.log('  Data:', data.remaining, 'GB /', data.used, 'GB /', data.balance, 'EGP');
    
    if (!data.remaining && data.remaining !== 0) {
      throw new Error('No data extracted');
    }
    
    const quotaData = {
      '104': {
        remaining: `${data.remaining.toFixed(2)} GB`,
        used: `${data.used.toFixed(2)} GB`,
        total: `${data.total.toFixed(2)} GB`,
        balance: `${data.balance.toFixed(2)} EGP`,
        planName: data.plan || 'Unknown',
        updatedAt: new Date().toISOString(),
        updatedBy: 'GitHub Cloud ⚡',
        status: 'success'
      },
      lastUpdate: new Date().toISOString()
    };
    
    console.log('7️⃣ Firestore...');
    
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
      throw new Error(`Firestore failed: ${response.status}`);
    }
    
    console.log('✅ SUCCESS');
    
  } catch (error) {
    console.error('❌ ERROR:', error.message);
    throw error;
  } finally {
    if (browser) await browser.close();
  }
}

async function main() {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      console.log(`\n=== Attempt ${attempt}/${MAX_RETRIES} ===`);
      await harvestQuota();
      console.log('\n✅ Complete!');
      process.exit(0);
    } catch (error) {
      console.error(`Attempt ${attempt} failed: ${error.message}`);
      if (attempt < MAX_RETRIES) {
        const retryDelay = randomDelay(20000, 30000);
        console.log(`Retry in ${Math.floor(retryDelay/1000)}s...`);
        await sleep(retryDelay);
      } else {
        console.error('\n❌ All attempts failed');
        process.exit(1);
      }
    }
  }
}

main();
