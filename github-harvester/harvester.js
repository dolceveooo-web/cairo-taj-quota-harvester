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

// Timeout wrapper for ANY operation
async function withTimeout(promise, timeoutMs, operationName) {
  return Promise.race([
    promise,
    new Promise((_, reject) => 
      setTimeout(() => reject(new Error(`${operationName} timeout after ${timeoutMs}ms`)), timeoutMs)
    )
  ]);
}

async function tryMultipleMethods(methodsArray, stepName, timeout = 25000) {
  for (let i = 0; i < methodsArray.length; i++) {
    try {
      console.log(`  [Method ${i + 1}/${methodsArray.length}]`);
      const result = await withTimeout(methodsArray[i](), timeout, `${stepName} Method ${i + 1}`);
      console.log(`  ✓ Method ${i + 1} SUCCESS`);
      return result;
    } catch (error) {
      console.log(`  ✗ Method ${i + 1} FAILED: ${error.message}`);
      if (i === methodsArray.length - 1) {
        throw new Error(`${stepName} - ALL ${methodsArray.length} METHODS FAILED`);
      }
      await sleep(1000);
    }
  }
}

async function harvestQuota() {
  console.log('🚀 CLOUD HARVESTER STARTING...\n');
  
  let browser;
  let page;
  
  try {
    console.log('🔧 Launching browser...');
    browser = await puppeteer.launch({
      headless: true,
      executablePath: '/usr/bin/google-chrome-stable',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-blink-features=AutomationControlled',
        '--window-size=1920,1080'
      ],
      ignoreDefaultArgs: ['--enable-automation']
    });
    console.log('✓ Browser launched\n');

    page = await browser.newPage();
    
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
      window.navigator.chrome = { runtime: {} };
      Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3] });
    });

    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
    await page.setViewport({ width: 1920, height: 1080 });
    
    // ========== STEP 1: NAVIGATE (5 METHODS) ==========
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('STEP 1: NAVIGATE');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    
    await tryMultipleMethods([
      async () => {
        await page.goto('https://my.te.eg/echannel/', { waitUntil: 'domcontentloaded', timeout: 40000 });
        await sleep(8000);
        console.log('    Strategy: domcontentloaded + 8s wait');
      },
      async () => {
        await page.goto('https://my.te.eg/echannel/', { waitUntil: 'networkidle2', timeout: 45000 });
        await sleep(5000);
        console.log('    Strategy: networkidle2 + 5s wait');
      },
      async () => {
        await page.goto('https://my.te.eg/echannel/', { waitUntil: 'load', timeout: 40000 });
        await sleep(10000);
        console.log('    Strategy: load + 10s wait');
      },
      async () => {
        await page.goto('https://my.te.eg/echannel/', { timeout: 40000 });
        await sleep(12000);
        console.log('    Strategy: no wait + 12s sleep');
      },
      async () => {
        await page.goto('https://my.te.eg/echannel/', { waitUntil: 'domcontentloaded', timeout: 40000 });
        await sleep(15000);
        console.log('    Strategy: domcontentloaded + 15s wait (max patience)');
      }
    ], 'NAVIGATE', 50000);
    
    console.log('  URL:', page.url());
    console.log('');
    
    // ========== STEP 2: USERNAME (5 METHODS) ==========
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('STEP 2: USERNAME');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    
    await tryMultipleMethods([
      async () => {
        await sleep(2000);
        const input = await page.$('#login_loginid_input_01');
        if (!input) throw new Error('Selector not found');
        await input.click();
        await sleep(300);
        await input.type(WE_USERNAME, { delay: 50 });
        console.log('    Strategy: Direct selector #login_loginid_input_01');
      },
      async () => {
        await sleep(3000);
        const inputs = await page.$$('input:not([type="password"])');
        if (inputs.length === 0) throw new Error('No text inputs');
        await inputs[0].click();
        await sleep(300);
        await inputs[0].type(WE_USERNAME, { delay: 50 });
        console.log('    Strategy: First non-password input');
      },
      async () => {
        await sleep(4000);
        await page.evaluate((username) => {
          const input = document.querySelector('#login_loginid_input_01') || 
                        document.querySelector('input[type="text"]');
          if (input) {
            input.value = username;
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
          } else throw new Error('No input found');
        }, WE_USERNAME);
        console.log('    Strategy: Direct DOM manipulation');
      },
      async () => {
        await sleep(5000);
        await page.click('input');
        await sleep(300);
        await page.keyboard.type(WE_USERNAME, { delay: 50 });
        console.log('    Strategy: Click any input + keyboard');
      },
      async () => {
        await sleep(6000);
        const allInputs = await page.$$('input');
        for (let inp of allInputs) {
          const type = await inp.evaluate(el => el.type);
          if (type !== 'password') {
            await inp.click();
            await sleep(300);
            await inp.type(WE_USERNAME, { delay: 50 });
            console.log('    Strategy: Loop through inputs');
            return;
          }
        }
        throw new Error('No suitable input');
      }
    ], 'USERNAME', 30000);
    
    console.log('  ✓ Username:', WE_USERNAME);
    console.log('');
    
    // ========== STEP 3: DROPDOWN (5 METHODS) ==========
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('STEP 3: DROPDOWN');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    
    await tryMultipleMethods([
      async () => {
        await sleep(2000);
        await page.click('.ant-select-selector');
        await sleep(2000);
        await page.evaluate(() => {
          const items = document.querySelectorAll('.ant-select-item-option, li');
          for (let item of items) {
            if (item.textContent?.toLowerCase().includes('internet')) {
              item.click();
              return;
            }
          }
        });
        console.log('    Strategy: Click selector + evaluate');
      },
      async () => {
        await sleep(2000);
        await page.click('.ant-select');
        await sleep(1500);
        await page.keyboard.press('ArrowDown');
        await sleep(300);
        await page.keyboard.press('Enter');
        console.log('    Strategy: Click + keyboard navigation');
      },
      async () => {
        await sleep(2000);
        for (let i = 0; i < 5; i++) {
          await page.click('.ant-select-selector').catch(() => {});
          await sleep(1000);
        }
        await page.evaluate(() => {
          const items = document.querySelectorAll('li, div, span');
          for (let item of items) {
            if (item.textContent?.toLowerCase().includes('internet')) {
              item.click();
              return;
            }
          }
        });
        console.log('    Strategy: Multiple clicks + broad search');
      },
      async () => {
        await sleep(3000);
        await page.evaluate(() => {
          const select = document.querySelector('.ant-select-selector');
          if (select) select.click();
        });
        await sleep(2000);
        await page.evaluate(() => {
          const items = Array.from(document.querySelectorAll('*'));
          for (let item of items) {
            if (item.textContent?.trim().toLowerCase() === 'internet') {
              item.click();
              return;
            }
          }
        });
        console.log('    Strategy: Evaluate click + exact text match');
      },
      async () => {
        await sleep(2000);
        const dropdowns = await page.$$('[class*="select"]');
        if (dropdowns.length > 0) {
          await dropdowns[0].click();
          await sleep(2000);
          await page.keyboard.type('Internet');
          await sleep(500);
          await page.keyboard.press('Enter');
        }
        console.log('    Strategy: Generic selector + type');
      }
    ], 'DROPDOWN', 30000);
    
    console.log('  ✓ Selected: Internet');
    console.log('');
    
    // ========== STEP 4: PASSWORD (5 METHODS) ==========
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('STEP 4: PASSWORD');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    
    await tryMultipleMethods([
      async () => {
        await sleep(2000);
        const input = await page.$('#login_password_input_01');
        if (!input) throw new Error('Selector not found');
        await input.click();
        await sleep(300);
        await input.type(WE_PASSWORD, { delay: 50 });
        console.log('    Strategy: Direct selector #login_password_input_01');
      },
      async () => {
        await sleep(3000);
        const inputs = await page.$$('input[type="password"]');
        if (inputs.length === 0) throw new Error('No password inputs');
        await inputs[0].click();
        await sleep(300);
        await inputs[0].type(WE_PASSWORD, { delay: 50 });
        console.log('    Strategy: First password input');
      },
      async () => {
        await sleep(4000);
        await page.evaluate((password) => {
          const input = document.querySelector('#login_password_input_01') || 
                        document.querySelector('input[type="password"]');
          if (input) {
            input.value = password;
            input.dispatchEvent(new Event('input', { bubbles: true }));
          } else throw new Error('No password input');
        }, WE_PASSWORD);
        console.log('    Strategy: Direct DOM manipulation');
      },
      async () => {
        await sleep(5000);
        await page.click('input[type="password"]');
        await sleep(300);
        await page.keyboard.type(WE_PASSWORD, { delay: 50 });
        console.log('    Strategy: Click password + keyboard');
      },
      async () => {
        await sleep(6000);
        const allInputs = await page.$$('input');
        for (let inp of allInputs) {
          const type = await inp.evaluate(el => el.type);
          if (type === 'password') {
            await inp.click();
            await sleep(300);
            await inp.type(WE_PASSWORD, { delay: 50 });
            console.log('    Strategy: Loop to find password');
            return;
          }
        }
        throw new Error('No password input');
      }
    ], 'PASSWORD', 30000);
    
    console.log('  ✓ Password entered');
    console.log('');
    
    // ========== STEP 5: SUBMIT (5 METHODS) ==========
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('STEP 5: SUBMIT');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    
    await tryMultipleMethods([
      async () => {
        await page.evaluate(() => {
          const btns = document.querySelectorAll('button');
          for (let btn of btns) {
            if (btn.textContent.toLowerCase().includes('login')) {
              btn.click();
              return;
            }
          }
        });
        await sleep(15000);
        console.log('    Strategy: Find login button');
      },
      async () => {
        await page.keyboard.press('Enter');
        await sleep(15000);
        console.log('    Strategy: Press Enter');
      },
      async () => {
        const buttons = await page.$$('button');
        if (buttons.length > 0) {
          await buttons[0].click();
        }
        await sleep(15000);
        console.log('    Strategy: Click first button');
      },
      async () => {
        await page.click('button[type="submit"]').catch(() => {});
        await sleep(15000);
        console.log('    Strategy: Submit button');
      },
      async () => {
        await page.evaluate(() => {
          const forms = document.querySelectorAll('form');
          if (forms[0]) forms[0].submit();
        });
        await sleep(15000);
        console.log('    Strategy: Form submit');
      }
    ], 'SUBMIT', 25000);
    
    const finalUrl = page.url();
    console.log('  Final URL:', finalUrl);
    
    if (finalUrl.includes('login')) {
      throw new Error('Still on login page - credentials may be wrong');
    }
    
    console.log('  ✓ Login successful!');
    console.log('');
    
    // ========== STEP 6: EXTRACT (5 METHODS) ==========
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('STEP 6: EXTRACT DATA');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    
    const data = await tryMultipleMethods([
      async () => {
        await sleep(5000);
        return await page.evaluate(() => {
          const text = document.body.innerText;
          const remaining = text.match(/Remaining[^\d]*(\d+\.?\d*)/i);
          const used = text.match(/Used[^\d]*(\d+\.?\d*)/i);
          const balance = text.match(/Balance[^\d]*(\d+\.?\d*)/i);
          if (!remaining) throw new Error('No data');
          return {
            remaining: parseFloat(remaining[1]),
            used: parseFloat(used?.[1] || 0),
            balance: parseFloat(balance?.[1] || 0)
          };
        });
      },
      async () => {
        await sleep(8000);
        return await page.evaluate(() => {
          const spans = document.querySelectorAll('span, div');
          let remaining = null, used = null, balance = null;
          for (let i = 0; i < spans.length; i++) {
            const t = spans[i].innerText?.trim();
            if (t === 'Remaining' && spans[i-1]) remaining = parseFloat(spans[i-1].innerText);
            if (t === 'Used' && spans[i-1]) used = parseFloat(spans[i-1].innerText);
            if (t.includes('Balance') && spans[i+1]) balance = parseFloat(spans[i+1].innerText);
          }
          if (remaining === null) throw new Error('No data');
          return { remaining, used: used || 0, balance: balance || 0 };
        });
      },
      async () => {
        await sleep(10000);
        const html = await page.content();
        const remaining = html.match(/Remaining[^\d]*(\d+\.?\d*)/i);
        const used = html.match(/Used[^\d]*(\d+\.?\d*)/i);
        const balance = html.match(/Balance[^\d]*(\d+\.?\d*)/i);
        if (!remaining) throw new Error('No data');
        return {
          remaining: parseFloat(remaining[1]),
          used: parseFloat(used?.[1] || 0),
          balance: parseFloat(balance?.[1] || 0)
        };
      },
      async () => {
        await sleep(12000);
        return await page.evaluate(() => {
          const text = document.documentElement.textContent;
          const remaining = text.match(/(\d+\.?\d*)[^\d]*GB[^\d]*Remaining/i) || 
                          text.match(/Remaining[^\d]*(\d+\.?\d*)/i);
          if (!remaining) throw new Error('No data');
          return {
            remaining: parseFloat(remaining[1]),
            used: 0,
            balance: 0
          };
        });
      },
      async () => {
        await sleep(15000);
        const screenshot = await page.screenshot({ encoding: 'base64' });
        console.log('    Screenshot length:', screenshot.length);
        throw new Error('Manual extraction needed - check screenshot');
      }
    ], 'EXTRACT', 35000);
    
    console.log('  Remaining:', data.remaining, 'GB');
    console.log('  Used:', data.used, 'GB');
    console.log('  Balance:', data.balance, 'EGP');
    console.log('');
    
    // ========== STEP 7: FIRESTORE (3 METHODS) ==========
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('STEP 7: UPLOAD TO FIRESTORE');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    
    const quotaData = {
      '104': {
        remaining: `${data.remaining.toFixed(2)} GB`,
        used: `${data.used.toFixed(2)} GB`,
        total: `${(data.remaining + data.used).toFixed(2)} GB`,
        balance: `${data.balance.toFixed(2)} EGP`,
        planName: 'Unknown',
        updatedAt: new Date().toISOString(),
        updatedBy: 'GitHub Cloud ⚡',
        status: 'success'
      },
      lastUpdate: new Date().toISOString()
    };
    
    await tryMultipleMethods([
      async () => {
        const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/quota_latest/current?key=${FIREBASE_API_KEY}`;
        const response = await fetch(url, {
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
        console.log('    Strategy: Standard PATCH');
      },
      async () => {
        await sleep(2000);
        const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/quota_latest/current?key=${FIREBASE_API_KEY}`;
        const response = await fetch(url, {
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
        console.log('    Strategy: Retry PATCH');
      },
      async () => {
        await sleep(3000);
        const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/quota_latest/current?updateMask.fieldPaths=104&key=${FIREBASE_API_KEY}`;
        const response = await fetch(url, {
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
        console.log('    Strategy: UpdateMask PATCH');
      }
    ], 'FIRESTORE', 20000);
    
    console.log('  ✓ Data uploaded successfully');
    console.log('');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('✅ ✅ ✅  SUCCESS  ✅ ✅ ✅');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    
  } catch (error) {
    console.error('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.error('❌ ❌ ❌  FAILURE  ❌ ❌ ❌');
    console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.error('Error:', error.message);
    console.error('Stack:', error.stack);
    
    if (page) {
      try {
        console.log('\n📸 Capturing diagnostics...');
        const screenshot = await withTimeout(page.screenshot({ encoding: 'base64' }), 5000, 'Screenshot');
        console.log('Screenshot length:', screenshot.length);
      } catch (e) {
        console.log('Could not capture screenshot:', e.message);
      }
    }
    
    throw error;
  } finally {
    if (browser) {
      await browser.close();
      console.log('\n🔒 Browser closed\n');
    }
  }
}

async function main() {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      console.log('\n' + '═'.repeat(60));
      console.log(`  ATTEMPT ${attempt}/${MAX_RETRIES}`);
      console.log('═'.repeat(60) + '\n');
      
      await harvestQuota();
      
      console.log('\n' + '═'.repeat(60));
      console.log('  🎉 HARVESTER COMPLETE! 🎉');
      console.log('═'.repeat(60) + '\n');
      
      process.exit(0);
    } catch (error) {
      console.error(`\n⚠️  Attempt ${attempt}/${MAX_RETRIES} failed: ${error.message}\n`);
      
      if (attempt < MAX_RETRIES) {
        const delay = randomDelay(30000, 45000);
        console.log(`⏳ Retrying in ${Math.floor(delay/1000)} seconds...\n`);
        await sleep(delay);
      } else {
        console.error('\n' + '═'.repeat(60));
        console.error('  💀 ALL ATTEMPTS EXHAUSTED 💀');
        console.error('═'.repeat(60) + '\n');
        process.exit(1);
      }
    }
  }
}

main();
