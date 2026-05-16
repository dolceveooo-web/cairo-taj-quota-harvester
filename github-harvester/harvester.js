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
        '--disable-features=VizDisplayCompositor'
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
    await page.setViewport({ width: 1920, height: 1080 });
    
    // ========== STEP 1: NAVIGATE ==========
    console.log('\n1️⃣ NAVIGATING...');
    console.log('  Target: https://my.te.eg/echannel/');
    
    await page.goto('https://my.te.eg/echannel/', { 
      waitUntil: 'domcontentloaded', 
      timeout: 60000 
    });
    console.log('  ✓ Page loaded (domcontentloaded)');
    
    await sleep(8000);
    console.log('  ✓ Waited 8 seconds for dynamic content');
    
    const url1 = page.url();
    const title1 = await page.title();
    console.log('  URL:', url1);
    console.log('  Title:', title1);
    
    // Wait for ANY form element to appear
    console.log('  Waiting for login form elements...');
    await page.waitForFunction(
      () => {
        return document.querySelector('#login_loginid_input_01') || 
               document.querySelector('input[type="text"]') ||
               document.querySelector('.ant-input');
      },
      { timeout: 30000 }
    );
    console.log('  ✓ Form elements detected');
    
    await sleep(3000);
    console.log('  ✓ Additional 3s wait');
    
    // ========== STEP 2: USERNAME ==========
    console.log('\n2️⃣ FILLING USERNAME...');
    console.log('  Looking for username field...');
    
    // Wait explicitly for username field
    await page.waitForSelector('#login_loginid_input_01', { 
      visible: true, 
      timeout: 20000 
    });
    console.log('  ✓ Username field found');
    
    await sleep(1000);
    
    // Click to focus
    await page.click('#login_loginid_input_01');
    console.log('  ✓ Clicked username field');
    await sleep(500);
    
    // Type username slowly
    await page.type('#login_loginid_input_01', WE_USERNAME, { delay: 50 });
    console.log('  ✓ Typed username:', WE_USERNAME);
    await sleep(1000);
    
    // Verify username was entered
    const usernameValue = await page.evaluate(() => {
      return document.querySelector('#login_loginid_input_01')?.value;
    });
    console.log('  ✓ Username verified:', usernameValue);
    
    if (usernameValue !== WE_USERNAME) {
      console.log('  ⚠ Username mismatch, retrying...');
      await page.evaluate((username) => {
        const input = document.querySelector('#login_loginid_input_01');
        input.value = username;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }, WE_USERNAME);
      await sleep(500);
    }
    
    // ========== STEP 3: SERVICE TYPE DROPDOWN ==========
    console.log('\n3️⃣ SELECTING SERVICE TYPE...');
    console.log('  Looking for dropdown...');
    
    // Wait for dropdown to exist
    await page.waitForFunction(
      () => {
        return document.querySelector('.ant-select') || 
               document.querySelector('.ant-select-selector') ||
               document.querySelector('[class*="select"]');
      },
      { timeout: 30000 }
    );
    console.log('  ✓ Dropdown element found');
    
    await sleep(2000);
    
    // Log dropdown state
    const dropdownInfo = await page.evaluate(() => {
      const dropdown = document.querySelector('.ant-select-selector');
      return {
        exists: !!dropdown,
        visible: dropdown ? dropdown.offsetParent !== null : false,
        classes: dropdown ? dropdown.className : null,
        text: dropdown ? dropdown.innerText : null
      };
    });
    console.log('  Dropdown state:', JSON.stringify(dropdownInfo));
    
    // Click dropdown multiple times
    console.log('  Clicking dropdown...');
    for (let i = 0; i < 5; i++) {
      await page.click('.ant-select-selector').catch(() => {});
      console.log(`  Click attempt ${i + 1}/5`);
      await sleep(1000);
      
      // Check if options appeared
      const optionsVisible = await page.evaluate(() => {
        const options = document.querySelectorAll('.ant-select-item-option, .ant-select-item, .ant-select-dropdown');
        return options.length > 0;
      });
      
      if (optionsVisible) {
        console.log('  ✓ Dropdown opened, options visible');
        break;
      }
    }
    
    await sleep(2000);
    
    // Try multiple ways to select "Internet"
    console.log('  Selecting "Internet" option...');
    
    // Method 1: Direct click
    const method1Success = await page.evaluate(() => {
      const items = Array.from(document.querySelectorAll('.ant-select-item-option, .ant-select-item, li, div'));
      for (let item of items) {
        const text = item.textContent?.toLowerCase() || '';
        if (text.includes('internet') && !text.includes('mobile')) {
          item.click();
          return true;
        }
      }
      return false;
    });
    
    if (method1Success) {
      console.log('  ✓ Method 1: Direct click succeeded');
    } else {
      console.log('  ✗ Method 1 failed, trying keyboard...');
      
      // Method 2: Keyboard
      await page.keyboard.press('ArrowDown');
      await sleep(300);
      await page.keyboard.press('ArrowDown');
      await sleep(300);
      await page.keyboard.press('Enter');
      console.log('  ✓ Method 2: Keyboard navigation attempted');
    }
    
    await sleep(2000);
    
    // Verify selection
    const selectedValue = await page.evaluate(() => {
      const selected = document.querySelector('.ant-select-selection-item');
      return selected ? selected.textContent.trim() : null;
    });
    console.log('  Selected value:', selectedValue || 'UNKNOWN');
    
    if (!selectedValue || !selectedValue.toLowerCase().includes('internet')) {
      console.log('  ⚠ Selection unclear, forcing value...');
      
      // Force click dropdown again and select
      await page.click('.ant-select-selector');
      await sleep(1500);
      await page.evaluate(() => {
        const items = document.querySelectorAll('.ant-select-item-option, .ant-select-item, li, div, span');
        for (let item of items) {
          if (item.textContent?.toLowerCase().includes('internet')) {
            item.click();
            break;
          }
        }
      });
      await sleep(1000);
    }
    
    // ========== STEP 4: PASSWORD ==========
    console.log('\n4️⃣ FILLING PASSWORD...');
    console.log('  Waiting for password field...');
    
    await sleep(2000);
    
    await page.waitForSelector('#login_password_input_01', { 
      visible: true, 
      timeout: 20000 
    });
    console.log('  ✓ Password field found');
    
    await sleep(1000);
    
    // Click password field
    await page.click('#login_password_input_01');
    console.log('  ✓ Clicked password field');
    await sleep(500);
    
    // Type password
    await page.type('#login_password_input_01', WE_PASSWORD, { delay: 50 });
    console.log('  ✓ Password entered');
    await sleep(1000);
    
    // Verify password filled
    const passwordFilled = await page.evaluate(() => {
      return !!document.querySelector('#login_password_input_01')?.value;
    });
    console.log('  ✓ Password verified:', passwordFilled ? 'YES' : 'NO');
    
    // ========== STEP 5: SUBMIT ==========
    console.log('\n5️⃣ SUBMITTING FORM...');
    
    // Click outside to trigger validation
    await page.click('body');
    await sleep(1000);
    
    // Find and click login button
    const buttonClicked = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      for (let btn of buttons) {
        const text = btn.textContent?.toLowerCase() || '';
        if (text.includes('login') || text.includes('sign') || btn.type === 'submit') {
          btn.click();
          return true;
        }
      }
      return false;
    });
    
    if (buttonClicked) {
      console.log('  ✓ Login button clicked');
    } else {
      console.log('  ⚠ Button not found, trying Enter key...');
      await page.keyboard.press('Enter');
    }
    
    console.log('  Waiting for navigation...');
    await sleep(15000);
    
    const url2 = page.url();
    console.log('  New URL:', url2);
    
    if (url2.includes('#/login')) {
      const errorMsg = await page.evaluate(() => {
        const errorEl = document.querySelector('.ant-form-item-explain-error, [class*="error"], .error-message');
        return errorEl ? errorEl.innerText : null;
      });
      
      if (errorMsg) {
        console.log('  ❌ Login error:', errorMsg);
      }
      
      throw new Error('Login failed - still on login page');
    }
    
    console.log('  ✓ Login successful!');
    
    // ========== STEP 6: EXTRACT DATA ==========
    console.log('\n6️⃣ EXTRACTING QUOTA DATA...');
    
    await sleep(5000);
    console.log('  Waiting for data to load...');
    
    const data = await page.evaluate(() => {
      const spans = Array.from(document.querySelectorAll('span, div, p'));
      let remaining = null, used = null, balance = null, plan = null;

      for (let i = 0; i < spans.length; i++) {
        const t = spans[i].innerText?.trim();
        if (!t) continue;
        
        if (t === 'Remaining' && spans[i-1]) {
          remaining = parseFloat(spans[i-1].innerText);
        }
        if (t === 'Used' && spans[i-1]) {
          used = parseFloat(spans[i-1].innerText);
        }
        if (t.includes('Balance') && spans[i+1]) {
          balance = parseFloat(spans[i+1].innerText);
        }
        if (t.includes('GB') && t.toLowerCase().includes('speed')) {
          plan = t;
        }
      }

      const totalMatch = plan && plan.match(/(\d+)GB/);
      const total = totalMatch ? parseFloat(totalMatch[1]) : (remaining && used ? remaining + used : 0);

      return { remaining, used, total, balance, plan };
    });
    
    console.log('  Remaining:', data.remaining, 'GB');
    console.log('  Used:', data.used, 'GB');
    console.log('  Total:', data.total, 'GB');
    console.log('  Balance:', data.balance, 'EGP');
    console.log('  Plan:', data.plan || 'Unknown');
    
    if (data.remaining === null && data.remaining !== 0) {
      throw new Error('No quota data found on page');
    }
    
    // ========== STEP 7: PUSH TO FIRESTORE ==========
    console.log('\n7️⃣ UPLOADING TO FIRESTORE...');
    
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
      throw new Error(`Firestore upload failed: ${response.status} - ${errorText}`);
    }
    
    console.log('  ✓ Data uploaded successfully');
    console.log('\n✅ ✅ ✅ SUCCESS! ✅ ✅ ✅');
    
  } catch (error) {
    console.error('\n❌ ❌ ❌ ERROR ❌ ❌ ❌');
    console.error('Error:', error.message);
    
    if (page) {
      try {
        const screenshot = await page.screenshot({ encoding: 'base64', fullPage: false });
        console.log('\n📸 Screenshot captured (length):', screenshot.length);
        
        const pageState = await page.evaluate(() => {
          return {
            url: window.location.href,
            title: document.title,
            bodyText: document.body.innerText.substring(0, 1000)
          };
        }).catch(() => null);
        
        if (pageState) {
          console.log('\n📄 Page State:');
          console.log(JSON.stringify(pageState, null, 2));
        }
      } catch (e) {
        console.log('Could not capture diagnostics');
      }
    }
    
    throw error;
  } finally {
    if (browser) {
      await browser.close();
      console.log('\n🔒 Browser closed');
    }
  }
}

async function main() {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      console.log(`\n${'='.repeat(60)}`);
      console.log(`ATTEMPT ${attempt}/${MAX_RETRIES}`);
      console.log('='.repeat(60));
      
      await harvestQuota();
      
      console.log('\n' + '='.repeat(60));
      console.log('🎉 COMPLETE! ALL STEPS SUCCESSFUL! 🎉');
      console.log('='.repeat(60));
      
      process.exit(0);
    } catch (error) {
      console.error(`\n⚠️  Attempt ${attempt} failed: ${error.message}`);
      
      if (attempt < MAX_RETRIES) {
        const retryDelay = randomDelay(25000, 35000);
        console.log(`\n⏳ Retrying in ${Math.floor(retryDelay/1000)} seconds...\n`);
        await sleep(retryDelay);
      } else {
        console.error('\n' + '='.repeat(60));
        console.error('💀 ALL ATTEMPTS FAILED 💀');
        console.error('='.repeat(60));
        process.exit(1);
      }
    }
  }
}

main();
