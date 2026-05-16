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

async function tryMultipleMethods(methodsArray, stepName) {
  for (let i = 0; i < methodsArray.length; i++) {
    try {
      console.log(`  Method ${i + 1}/${methodsArray.length}...`);
      const result = await Promise.race([
        methodsArray[i](),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Method timeout')), 15000))
      ]);
      console.log(`  ✓ Method ${i + 1} succeeded`);
      return result;
    } catch (error) {
      console.log(`  ✗ Method ${i + 1} failed: ${error.message}`);
      if (i === methodsArray.length - 1) {
        throw new Error(`${stepName} failed - all methods exhausted`);
      }
    }
  }
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
    
    // STEP 1: Navigate with 3 fallback methods
    console.log('1️⃣ Navigating...');
    await tryMultipleMethods([
      async () => {
        await page.goto('https://my.te.eg/echannel/', { waitUntil: 'domcontentloaded', timeout: 20000 });
        await sleep(3000);
      },
      async () => {
        await page.goto('https://my.te.eg/echannel/', { waitUntil: 'load', timeout: 20000 });
        await sleep(3000);
      },
      async () => {
        await page.goto('https://my.te.eg/echannel/', { timeout: 20000 });
        await sleep(5000);
      }
    ], 'Navigation');
    
    // STEP 2: Fill username with 3 fallback methods
    console.log('2️⃣ Username...');
    await tryMultipleMethods([
      async () => {
        await page.waitForSelector('#login_loginid_input_01', { timeout: 10000, visible: true });
        await page.focus('#login_loginid_input_01');
        await sleep(200);
        await page.type('#login_loginid_input_01', WE_USERNAME, { delay: 20 });
        await sleep(500);
      },
      async () => {
        await page.waitForFunction(() => document.querySelector('#login_loginid_input_01'), { timeout: 10000 });
        await page.evaluate((username) => {
          document.querySelector('#login_loginid_input_01').value = username;
        }, WE_USERNAME);
        await sleep(500);
      },
      async () => {
        await sleep(2000);
        const input = await page.$('#login_loginid_input_01');
        if (!input) throw new Error('Username input not found');
        await input.type(WE_USERNAME, { delay: 20 });
        await sleep(500);
      }
    ], 'Username input');
    
    // STEP 3: Select service type with 3 fallback methods
    console.log('3️⃣ Service type...');
    await tryMultipleMethods([
      async () => {
        const dropdown = await page.$('.ant-select-selector');
        if (!dropdown) throw new Error('Dropdown not found');
        await dropdown.click();
        await sleep(500);
        const selected = await page.evaluate(() => {
          const items = Array.from(document.querySelectorAll('.ant-select-item-option, .ant-select-item, li'));
          const internet = items.find(i => i.textContent.toLowerCase().includes('internet'));
          if (internet) { internet.click(); return internet.textContent.trim(); }
          return null;
        });
        if (!selected) throw new Error('Internet option not found');
        await sleep(300);
      },
      async () => {
        await page.click('.ant-select');
        await sleep(500);
        await page.keyboard.type('Internet');
        await sleep(200);
        await page.keyboard.press('Enter');
        await sleep(300);
      },
      async () => {
        await page.evaluate(() => {
          const select = document.querySelector('.ant-select-selector');
          if (select) select.click();
        });
        await sleep(500);
        await page.evaluate(() => {
          const items = document.querySelectorAll('[class*="select-item"]');
          for (let item of items) {
            if (item.textContent.toLowerCase().includes('internet')) {
              item.click();
              break;
            }
          }
        });
        await sleep(300);
      }
    ], 'Service type selection');
    
    // STEP 4: Fill password with 3 fallback methods
    console.log('4️⃣ Password...');
    await sleep(1000); // Wait for dropdown to close
    await tryMultipleMethods([
      async () => {
        await page.waitForSelector('#login_password_input_01', { timeout: 5000, visible: true });
        await page.focus('#login_password_input_01');
        await sleep(200);
        await page.type('#login_password_input_01', WE_PASSWORD, { delay: 20 });
        await sleep(300);
      },
      async () => {
        await sleep(1000);
        await page.evaluate((password) => {
          const input = document.querySelector('#login_password_input_01');
          if (input) input.value = password;
          else throw new Error('Password field not found');
        }, WE_PASSWORD);
        await sleep(300);
      },
      async () => {
        await sleep(1500);
        const input = await page.$('#login_password_input_01');
        if (!input) throw new Error('Password input not found');
        await input.type(WE_PASSWORD, { delay: 20 });
        await sleep(300);
      }
    ], 'Password input');
    
    // STEP 5: Submit with 3 fallback methods
    console.log('5️⃣ Submit...');
    await tryMultipleMethods([
      async () => {
        // Trigger validation by clicking outside first
        await page.click('body');
        await sleep(500);
        await page.evaluate(() => {
          const btns = Array.from(document.querySelectorAll('button'));
          const btn = btns.find(b => b.textContent.toLowerCase().includes('login') || b.className.includes('primary'));
          if (btn) btn.click();
          else throw new Error('Login button not found');
        });
        await sleep(10000);
      },
      async () => {
        await page.click('#login_password_input_01');
        await sleep(300);
        await page.keyboard.press('Enter');
        await sleep(10000);
      },
      async () => {
        const button = await page.$('button[type="submit"]');
        if (button) await button.click();
        else throw new Error('Submit button not found');
        await sleep(10000);
      }
    ], 'Submit');
    
    const url = page.url();
    console.log('  URL:', url);
    
    if (url.includes('#/login')) {
      // Check for error message
      const errorMsg = await page.evaluate(() => {
        const errorEl = document.querySelector('.ant-form-item-explain-error, [class*="error"], .error-message');
        return errorEl ? errorEl.innerText : null;
      });
      if (errorMsg) console.log('  Error message:', errorMsg);
      throw new Error('Login failed');
    }
    console.log('  ✓ Login successful');
    
    // STEP 6: Extract data with 3 fallback methods
    console.log('6️⃣ Extracting...');
    const data = await tryMultipleMethods([
      async () => {
        await sleep(2000);
        return await page.evaluate(() => {
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

          if (!remaining && remaining !== 0) throw new Error('No data found');
          return { remaining, used, total, balance, plan };
        });
      },
      async () => {
        await sleep(4000);
        return await page.evaluate(() => {
          const getText = (selector) => document.querySelector(selector)?.innerText?.trim();
          const remaining = parseFloat(getText('[class*="remaining"]')) || 0;
          const used = parseFloat(getText('[class*="used"]')) || 0;
          const balance = parseFloat(getText('[class*="balance"]')) || 0;
          if (!remaining && remaining !== 0) throw new Error('No data found');
          return { remaining, used, total: remaining + used, balance, plan: 'Unknown' };
        });
      },
      async () => {
        await sleep(3000);
        const content = await page.content();
        const remainingMatch = content.match(/Remaining[^\d]*([\d.]+)/i);
        const usedMatch = content.match(/Used[^\d]*([\d.]+)/i);
        const balanceMatch = content.match(/Balance[^\d]*([\d.]+)/i);
        
        if (!remainingMatch) throw new Error('No data found');
        
        const remaining = parseFloat(remainingMatch[1]);
        const used = parseFloat(usedMatch?.[1] || 0);
        const balance = parseFloat(balanceMatch?.[1] || 0);
        
        return { remaining, used, total: remaining + used, balance, plan: 'Unknown' };
      }
    ], 'Data extraction');
    
    console.log('  Data:', data.remaining, 'GB /', data.used, 'GB /', data.balance, 'EGP');
    
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
    
    // STEP 7: Push to Firestore with 3 fallback methods
    console.log('7️⃣ Firestore...');
    await tryMultipleMethods([
      async () => {
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
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
      },
      async () => {
        await sleep(2000);
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
          }),
          timeout: 10000
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
      },
      async () => {
        await sleep(3000);
        const firestoreUrl = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/quota_latest/current?updateMask.fieldPaths=104&key=${FIREBASE_API_KEY}`;
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
              }
            }
          })
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
      }
    ], 'Firestore upload');
    
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
