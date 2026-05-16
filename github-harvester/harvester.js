const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fetch = require('node-fetch');

puppeteer.use(StealthPlugin());

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
    browser = await puppeteer.launch({
      headless: true,
      executablePath: '/usr/bin/google-chrome-stable',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-blink-features=AutomationControlled',
        '--disable-features=IsolateOrigins,site-per-process'
      ],
      ignoreDefaultArgs: ['--enable-automation']
    });

    const page = await browser.newPage();

    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
      window.navigator.chrome = { runtime: {} };
      Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
      Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
    });

    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.setViewport({ width: 1366, height: 768 });
    
    console.log('1️⃣ Navigating...');
    const response = await page.goto('https://my.te.eg/echannel/', { waitUntil: 'networkidle2', timeout: 60000 });
    console.log('  Status:', response.status());
    await sleep(randomDelay(4000, 6000));
    
    const pageTitle = await page.title();
    console.log('  Page title:', pageTitle);
    
    const hasLoginForm = await page.evaluate(() => {
      return document.querySelectorAll('input').length >= 2;
    });
    console.log('  Login form present:', hasLoginForm);
    
    console.log('2️⃣ Username...');
    await page.waitForFunction(() => document.querySelectorAll('input').length >= 2, { timeout: 20000 });
    await page.waitForSelector('#login_loginid_input_01', { timeout: 20000, visible: true });
    await page.focus('#login_loginid_input_01');
    await sleep(200);
    await page.type('#login_loginid_input_01', WE_USERNAME, { delay: 20 });
    await sleep(800);
    
    console.log('3️⃣ Service type...');
    const dropdown = await page.$('.ant-select-selector');
    if (!dropdown) throw new Error('Dropdown not found');
    await dropdown.click();
    await sleep(800);
    const selected = await page.evaluate(() => {
      const items = Array.from(document.querySelectorAll('.ant-select-item-option, .ant-select-item, li'));
      const internet = items.find(i => i.textContent.toLowerCase().includes('internet'));
      if (internet) { internet.click(); return internet.textContent.trim(); }
      return null;
    });
    console.log('  Selected:', selected || 'NOT FOUND');
    await sleep(500);
    
    console.log('4️⃣ Password...');
    await page.focus('#login_password_input_01');
    await sleep(200);
    await page.type('#login_password_input_01', WE_PASSWORD, { delay: 20 });
    await sleep(300);
    
    console.log('5️⃣ Submit...');
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const btn = btns.find(b => b.textContent.toLowerCase().includes('login') || b.className.includes('primary'));
      if (btn) btn.click();
    });
    await sleep(8000);
    
    const url = page.url();
    console.log('  URL:', url);
    
    if (url.includes('#/login')) {
      throw new Error('Login failed');
    }
    console.log('  ✓ Login successful');
    
    console.log('6️⃣ Extracting...');
    await sleep(2000);
    
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
