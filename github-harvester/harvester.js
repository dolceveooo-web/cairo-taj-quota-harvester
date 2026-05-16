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
  let page;
  try {
    browser = await puppeteer.launch({
      headless: true,
      executablePath: '/usr/bin/google-chrome-stable',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-blink-features=AutomationControlled',
        '--disable-features=IsolateOrigins,site-per-process',
        '--window-size=1920,1080',
        '--disable-web-security',
        '--disable-features=VizDisplayCompositor',
        '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      ],
      ignoreDefaultArgs: ['--enable-automation'],
      ignoreHTTPSErrors: true
    });

    page = await browser.newPage();

    // MAXIMUM STEALTH
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
      Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
      Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en', 'ar'] });
      window.navigator.chrome = { runtime: {} };
      
      // Override permissions
      const originalQuery = window.navigator.permissions.query;
      window.navigator.permissions.query = (parameters) => (
        parameters.name === 'notifications' ?
          Promise.resolve({ state: Notification.permission }) :
          originalQuery(parameters)
      );
    });

    await page.setViewport({ width: 1920, height: 1080 });
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'en-US,en;q=0.9,ar;q=0.8',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
    });
    
    // ========== STEP 1: NAVIGATE ==========
    console.log('\n1️⃣ NAVIGATING...');
    
    await page.goto('https://my.te.eg/echannel/', { 
      waitUntil: 'domcontentloaded', 
      timeout: 60000 
    });
    console.log('  ✓ Page loaded');
    
    await sleep(10000);
    console.log('  ✓ Waited 10 seconds');
    
    // Check if we're blocked
    const pageContent = await page.content();
    if (pageContent.includes('cloudflare') || pageContent.includes('challenge') || pageContent.includes('captcha')) {
      console.log('  ❌ BLOCKED: Cloudflare/WAF detected');
      throw new Error('Site is blocking automated access');
    }
    
    console.log('  ✓ No blocking detected');
    console.log('  URL:', page.url());
    
    // ========== STEP 2: FIND AND FILL USERNAME ==========
    console.log('\n2️⃣ USERNAME...');
    
    // List all inputs
    const inputs = await page.$$('input');
    console.log('  Found', inputs.length, 'input fields');
    
    if (inputs.length === 0) {
      console.log('  ❌ NO INPUTS FOUND - Page may be blocked');
      const html = await page.content();
      console.log('  HTML length:', html.length);
      console.log('  First 1000 chars:', html.substring(0, 1000));
      throw new Error('No input fields found');
    }
    
    // Find first non-password input
    let usernameInput = null;
    for (let i = 0; i < inputs.length; i++) {
      const type = await inputs[i].evaluate(el => el.type);
      if (type !== 'password') {
        usernameInput = inputs[i];
        console.log('  ✓ Using input', i, 'type:', type);
        break;
      }
    }
    
    if (!usernameInput) {
      throw new Error('No username input found');
    }
    
    await sleep(2000);
    await usernameInput.click();
    await sleep(500);
    await usernameInput.type(WE_USERNAME, { delay: 80 });
    console.log('  ✓ Username entered');
    await sleep(2000);
    
    // ========== STEP 3: DROPDOWN ==========
    console.log('\n3️⃣ DROPDOWN...');
    
    // Find dropdown
    const dropdowns = await page.$$('.ant-select, [class*="select"]');
    console.log('  Found', dropdowns.length, 'dropdowns');
    
    if (dropdowns.length > 0) {
      await sleep(1000);
      
      // Click dropdown
      await dropdowns[0].click();
      console.log('  ✓ Clicked dropdown');
      await sleep(2000);
      
      // Select Internet
      await page.evaluate(() => {
        const items = document.querySelectorAll('li, div, span');
        for (let item of items) {
          if (item.textContent?.toLowerCase().includes('internet')) {
            item.click();
            break;
          }
        }
      });
      console.log('  ✓ Selected Internet');
      await sleep(2000);
    } else {
      console.log('  ⚠ No dropdown found, skipping');
    }
    
    // ========== STEP 4: PASSWORD ==========
    console.log('\n4️⃣ PASSWORD...');
    
    // Find password input
    let passwordInput = null;
    for (let i = 0; i < inputs.length; i++) {
      const type = await inputs[i].evaluate(el => el.type);
      if (type === 'password') {
        passwordInput = inputs[i];
        console.log('  ✓ Found password field');
        break;
      }
    }
    
    if (!passwordInput) {
      // Refresh inputs list
      const newInputs = await page.$$('input[type="password"]');
      if (newInputs.length > 0) {
        passwordInput = newInputs[0];
        console.log('  ✓ Found password field (refreshed)');
      }
    }
    
    if (!passwordInput) {
      throw new Error('Password field not found');
    }
    
    await sleep(1000);
    await passwordInput.click();
    await sleep(500);
    await passwordInput.type(WE_PASSWORD, { delay: 80 });
    console.log('  ✓ Password entered');
    await sleep(2000);
    
    // ========== STEP 5: SUBMIT ==========
    console.log('\n5️⃣ SUBMIT...');
    
    // Find button
    const buttons = await page.$$('button');
    console.log('  Found', buttons.length, 'buttons');
    
    if (buttons.length > 0) {
      await buttons[0].click();
      console.log('  ✓ Clicked button');
    } else {
      await page.keyboard.press('Enter');
      console.log('  ✓ Pressed Enter');
    }
    
    await sleep(15000);
    console.log('  ✓ Waited for navigation');
    
    const finalUrl = page.url();
    console.log('  Final URL:', finalUrl);
    
    if (finalUrl.includes('login')) {
      throw new Error('Still on login page');
    }
    
    console.log('  ✓ Login successful');
    
    // ========== STEP 6: EXTRACT ==========
    console.log('\n6️⃣ EXTRACT...');
    
    await sleep(5000);
    
    const data = await page.evaluate(() => {
      const text = document.body.innerText;
      const remainingMatch = text.match(/Remaining[^\d]*(\d+\.?\d*)/i);
      const usedMatch = text.match(/Used[^\d]*(\d+\.?\d*)/i);
      const balanceMatch = text.match(/Balance[^\d]*(\d+\.?\d*)/i);
      
      return {
        remaining: remainingMatch ? parseFloat(remainingMatch[1]) : 0,
        used: usedMatch ? parseFloat(usedMatch[1]) : 0,
        balance: balanceMatch ? parseFloat(balanceMatch[1]) : 0
      };
    });
    
    console.log('  Remaining:', data.remaining, 'GB');
    console.log('  Used:', data.used, 'GB');
    console.log('  Balance:', data.balance, 'EGP');
    
    const total = data.remaining + data.used;
    
    // ========== STEP 7: FIRESTORE ==========
    console.log('\n7️⃣ FIRESTORE...');
    
    const quotaData = {
      '104': {
        remaining: `${data.remaining.toFixed(2)} GB`,
        used: `${data.used.toFixed(2)} GB`,
        total: `${total.toFixed(2)} GB`,
        balance: `${data.balance.toFixed(2)} EGP`,
        planName: 'Unknown',
        updatedAt: new Date().toISOString(),
        updatedBy: 'GitHub Cloud ⚡',
        status: 'success'
      },
      lastUpdate: new Date().toISOString()
    };
    
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
      throw new Error(`Firestore: ${response.status}`);
    }
    
    console.log('  ✓ Uploaded');
    console.log('\n✅ SUCCESS!');
    
  } catch (error) {
    console.error('\n❌ ERROR:', error.message);
    
    if (page) {
      try {
        const html = await page.content();
        console.log('\nHTML length:', html.length);
        if (html.length < 5000) {
          console.log('Full HTML:', html);
        }
      } catch (e) {}
    }
    
    throw error;
  } finally {
    if (browser) await browser.close();
  }
}

async function main() {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      console.log(`\n${'='.repeat(50)}`);
      console.log(`ATTEMPT ${attempt}/${MAX_RETRIES}`);
      console.log('='.repeat(50));
      
      await harvestQuota();
      
      console.log('\n🎉 COMPLETE!');
      process.exit(0);
    } catch (error) {
      console.error(`\nAttempt ${attempt} failed: ${error.message}`);
      
      if (attempt < MAX_RETRIES) {
        const delay = randomDelay(30000, 45000);
        console.log(`\nRetrying in ${Math.floor(delay/1000)}s...\n`);
        await sleep(delay);
      } else {
        console.error('\n💀 ALL FAILED');
        process.exit(1);
      }
    }
  }
}

main();
