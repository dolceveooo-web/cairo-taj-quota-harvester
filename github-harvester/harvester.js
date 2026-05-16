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

async function tryMultipleMethods(methodsArray, stepName, timeout = 20000) {
  for (let i = 0; i < methodsArray.length; i++) {
    try {
      console.log(`  Method ${i + 1}/${methodsArray.length}...`);
      const result = await Promise.race([
        methodsArray[i](),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Method timeout')), timeout))
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
        '--window-size=1366,768'
      ],
      ignoreDefaultArgs: ['--enable-automation']
    });

    page = await browser.newPage();

    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
      window.navigator.chrome = { runtime: {} };
      Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
      Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
    });

    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.setViewport({ width: 1366, height: 768 });
    
    // STEP 1: Navigate with 5 fallback methods
    console.log('1️⃣ Navigating...');
    await tryMultipleMethods([
      async () => {
        await page.goto('https://my.te.eg/echannel/', { waitUntil: 'domcontentloaded', timeout: 30000 });
        await sleep(5000);
        await page.waitForSelector('#login_loginid_input_01', { timeout: 15000, visible: true });
        console.log('  ✓ Login form detected');
      },
      async () => {
        await page.goto('https://my.te.eg/echannel/', { waitUntil: 'networkidle2', timeout: 35000 });
        await sleep(3000);
        await page.waitForSelector('#login_loginid_input_01', { timeout: 15000 });
        console.log('  ✓ Login form detected');
      },
      async () => {
        await page.goto('https://my.te.eg/echannel/', { waitUntil: 'load', timeout: 30000 });
        await sleep(6000);
        await page.waitForSelector('#login_loginid_input_01', { timeout: 15000 });
        console.log('  ✓ Login form detected');
      },
      async () => {
        await page.goto('https://my.te.eg/echannel/', { timeout: 30000 });
        await sleep(8000);
        const formExists = await page.$('#login_loginid_input_01');
        if (!formExists) throw new Error('Login form not found');
        console.log('  ✓ Login form detected');
      },
      async () => {
        await page.goto('https://my.te.eg/echannel/', { waitUntil: 'domcontentloaded', timeout: 30000 });
        await sleep(12000);
        await page.waitForFunction(
          () => document.querySelector('#login_loginid_input_01'),
          { timeout: 20000 }
        );
        console.log('  ✓ Login form detected');
      }
    ], 'Navigation', 50000);
    
    const currentUrl = page.url();
    console.log('  Current URL:', currentUrl);
    const pageTitle = await page.title();
    console.log('  Page title:', pageTitle);
    
    // STEP 2: Fill username with 5 fallback methods
    console.log('2️⃣ Username...');
    await tryMultipleMethods([
      async () => {
        await sleep(1000);
        await page.waitForSelector('#login_loginid_input_01', { timeout: 15000, visible: true });
        await page.focus('#login_loginid_input_01');
        await sleep(300);
        await page.type('#login_loginid_input_01', WE_USERNAME, { delay: 30 });
        await sleep(500);
      },
      async () => {
        await sleep(2000);
        await page.waitForFunction(() => document.querySelector('#login_loginid_input_01'), { timeout: 15000 });
        await page.evaluate((username) => {
          const input = document.querySelector('#login_loginid_input_01');
          if (input) {
            input.value = username;
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
          }
        }, WE_USERNAME);
        await sleep(500);
      },
      async () => {
        await sleep(3000);
        const input = await page.$('#login_loginid_input_01');
        if (!input) throw new Error('Username input not found');
        await input.click();
        await sleep(200);
        await input.type(WE_USERNAME, { delay: 30 });
        await sleep(500);
      },
      async () => {
        await sleep(4000);
        await page.click('#login_loginid_input_01');
        await sleep(300);
        await page.keyboard.type(WE_USERNAME, { delay: 30 });
        await sleep(500);
      },
      async () => {
        await sleep(6000);
        await page.evaluate((username) => {
          const input = document.querySelector('#login_loginid_input_01');
          if (!input) throw new Error('Username input not found');
          input.focus();
          input.value = username;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
          input.dispatchEvent(new Event('blur', { bubbles: true }));
        }, WE_USERNAME);
        await sleep(500);
      }
    ], 'Username input', 30000);
    
    // STEP 3: Select service type with 6 fallback methods
    console.log('3️⃣ Service type...');
    await tryMultipleMethods([
      // Method 1: Wait for dropdown, click, wait for options, click Internet
      async () => {
        await page.waitForSelector('.ant-select-selector', { timeout: 8000, visible: true });
        await sleep(1000);
        await page.click('.ant-select-selector');
        await sleep(1500);
        await page.waitForSelector('.ant-select-item-option', { timeout: 5000, visible: true });
        const selected = await page.evaluate(() => {
          const items = Array.from(document.querySelectorAll('.ant-select-item-option, .ant-select-item'));
          const internet = items.find(i => i.textContent.toLowerCase().includes('internet'));
          if (internet) { internet.click(); return true; }
          return false;
        });
        if (!selected) throw new Error('Internet option not found');
        await sleep(500);
      },
      // Method 2: Focus + keyboard navigation
      async () => {
        await page.waitForSelector('.ant-select', { timeout: 8000 });
        await sleep(1000);
        await page.focus('.ant-select');
        await sleep(300);
        await page.keyboard.press('Enter');
        await sleep(1000);
        await page.keyboard.type('Internet');
        await sleep(500);
        await page.keyboard.press('Enter');
        await sleep(500);
      },
      // Method 3: Direct DOM manipulation with MutationObserver
      async () => {
        await sleep(1500);
        const result = await page.evaluate(() => {
          return new Promise((resolve, reject) => {
            const select = document.querySelector('.ant-select-selector');
            if (!select) return reject(new Error('Dropdown not found'));
            
            select.click();
            
            const observer = new MutationObserver(() => {
              const items = document.querySelectorAll('.ant-select-item-option, .ant-select-item, li');
              for (let item of items) {
                if (item.textContent.toLowerCase().includes('internet')) {
                  item.click();
                  observer.disconnect();
                  resolve(true);
                  return;
                }
              }
            });
            
            observer.observe(document.body, { childList: true, subtree: true });
            setTimeout(() => { observer.disconnect(); reject(new Error('Timeout')); }, 5000);
          });
        });
        await sleep(500);
      },
      // Method 4: Multiple click attempts with delays
      async () => {
        await sleep(2000);
        for (let i = 0; i < 3; i++) {
          await page.click('.ant-select-selector').catch(() => {});
          await sleep(800);
        }
        await page.evaluate(() => {
          const items = Array.from(document.querySelectorAll('[class*="select"][class*="item"], li, div[role="option"]'));
          const internet = items.find(i => i.textContent.toLowerCase().includes('internet'));
          if (internet) { internet.click(); return; }
          throw new Error('Internet option not found');
        });
        await sleep(500);
      },
      // Method 5: Tab navigation from username field
      async () => {
        await page.focus('#login_loginid_input_01');
        await sleep(500);
        await page.keyboard.press('Tab');
        await sleep(800);
        await page.keyboard.press('Space');
        await sleep(1000);
        await page.keyboard.type('Internet');
        await sleep(500);
        await page.keyboard.press('Enter');
        await sleep(500);
      },
      // Method 6: Force value via React internal properties
      async () => {
        await sleep(2500);
        const result = await page.evaluate(() => {
          const select = document.querySelector('.ant-select');
          if (!select) throw new Error('Dropdown not found');
          
          // Try to find React fiber and trigger change
          const reactKey = Object.keys(select).find(key => key.startsWith('__react'));
          if (reactKey) {
            const fiber = select[reactKey];
            if (fiber?.memoizedProps?.onChange) {
              fiber.memoizedProps.onChange('Internet');
              return true;
            }
          }
          
          // Fallback: trigger all possible events
          select.click();
          setTimeout(() => {
            const items = document.querySelectorAll('.ant-select-item-option, .ant-select-item, li, [role="option"]');
            for (let item of items) {
              if (item.textContent.toLowerCase().includes('internet')) {
                item.click();
                return;
              }
            }
          }, 1000);
          
          return new Promise((resolve) => setTimeout(() => resolve(true), 2000));
        });
        await sleep(1000);
      }
    ], 'Service type selection', 25000);
    
    // STEP 4: Fill password with 4 fallback methods
    console.log('4️⃣ Password...');
    await sleep(1500); // Extended wait for dropdown to close
    
    // Verify dropdown selection succeeded
    const dropdownValue = await page.evaluate(() => {
      const selected = document.querySelector('.ant-select-selection-item');
      return selected ? selected.textContent.trim() : null;
    }).catch(() => null);
    console.log('  Dropdown value:', dropdownValue || 'Unknown');
    
    await tryMultipleMethods([
      async () => {
        await page.waitForSelector('#login_password_input_01', { timeout: 8000, visible: true });
        await page.focus('#login_password_input_01');
        await sleep(300);
        await page.type('#login_password_input_01', WE_PASSWORD, { delay: 30 });
        await sleep(500);
      },
      async () => {
        await sleep(1000);
        await page.evaluate((password) => {
          const input = document.querySelector('#login_password_input_01');
          if (input) input.value = password;
          else throw new Error('Password field not found');
        }, WE_PASSWORD);
        await sleep(500);
      },
      async () => {
        await sleep(1500);
        const input = await page.$('#login_password_input_01');
        if (!input) throw new Error('Password input not found');
        await input.type(WE_PASSWORD, { delay: 30 });
        await sleep(500);
      },
      async () => {
        await sleep(2000);
        await page.click('#login_password_input_01');
        await sleep(300);
        await page.keyboard.type(WE_PASSWORD, { delay: 30 });
        await sleep(500);
      }
    ], 'Password input', 20000);
    
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
    
    // Capture screenshot on failure
    if (page) {
      try {
        const screenshot = await page.screenshot({ encoding: 'base64', fullPage: false });
        console.log('  Screenshot captured (base64 length):', screenshot.length);
        
        // Log page state for debugging
        const pageState = await page.evaluate(() => {
          return {
            url: window.location.href,
            title: document.title,
            dropdownExists: !!document.querySelector('.ant-select'),
            dropdownValue: document.querySelector('.ant-select-selection-item')?.textContent || null,
            usernameValue: document.querySelector('#login_loginid_input_01')?.value || null,
            passwordFilled: !!document.querySelector('#login_password_input_01')?.value,
            visibleText: document.body.innerText.substring(0, 500)
          };
        }).catch(() => null);
        
        if (pageState) {
          console.log('  Page state:', JSON.stringify(pageState, null, 2));
        }
      } catch (screenshotError) {
        console.log('  Could not capture screenshot:', screenshotError.message);
      }
    }
    
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
