const { chromium } = require('playwright-chromium');
const fetch = require('node-fetch');

const FIREBASE_API_KEY = process.env.FIREBASE_API_KEY;
const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID;
const WE_USERNAME = process.env.WE_USERNAME;
const WE_PASSWORD = process.env.WE_PASSWORD;

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
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
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    });
    
    const page = await context.newPage();
    
    console.log('1️⃣ Navigating...');
    await page.goto('https://my.te.eg/echannel/', { timeout: 30000 });
    await sleep(2000);
    
    console.log('2️⃣ Username...');
    await page.fill('#login_loginid_input_01', WE_USERNAME);
    await sleep(500);
    
    console.log('3️⃣ Service type...');
    await page.keyboard.press('Tab');
    await sleep(500);
    await page.keyboard.type('Internet');
    await sleep(300);
    await page.keyboard.press('Enter');
    await sleep(1000);
    
    console.log('4️⃣ Password...');
    await page.keyboard.press('Tab');
    await sleep(300);
    await page.keyboard.type(WE_PASSWORD);
    await sleep(500);
    
    console.log('5️⃣ Submit...');
    await page.keyboard.press('Enter');
    await sleep(8000);
    
    const url = page.url();
    console.log('  URL: ' + url);
    
    if (url.includes('#/login')) {
      throw new Error('Login failed');
    }
    
    console.log('6️⃣ Extracting...');
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
      throw new Error('No data extracted');
    }
    
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
                remaining: { stringValue: `${data.remaining.toFixed(2)} GB` },
                used: { stringValue: `${data.used.toFixed(2)} GB` },
                total: { stringValue: `${data.total.toFixed(2)} GB` },
                balance: { stringValue: `${data.balance.toFixed(2)} EGP` },
                planName: { stringValue: data.plan || 'Unknown' },
                updatedAt: { stringValue: new Date().toISOString() },
                updatedBy: { stringValue: 'GitHub Cloud ⚡' },
                status: { stringValue: 'success' }
              }
            }
          },
          lastUpdate: { stringValue: new Date().toISOString() }
        }
      })
    });
    
    if (!response.ok) {
      throw new Error(`Firestore failed: ${response.status}`);
    }
    
    console.log('✅ SUCCESS!');
    
  } catch (error) {
    console.error('❌ ERROR:', error.message);
    throw error;
  } finally {
    if (browser) await browser.close();
  }
}

async function main() {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      console.log(`\n=== Attempt ${attempt}/3 ===`);
      await harvestQuota();
      process.exit(0);
    } catch (error) {
      console.error(`Attempt ${attempt} failed: ${error.message}`);
      if (attempt < 3) {
        console.log('Retrying in 10s...');
        await sleep(10000);
      } else {
        process.exit(1);
      }
    }
  }
}

main();
