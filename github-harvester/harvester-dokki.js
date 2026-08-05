const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fetch = require('node-fetch');

puppeteer.use(StealthPlugin());

const FIREBASE_API_KEY = process.env.FIREBASE_API_KEY;
const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID;
const WE_USERNAME = process.env.DOKKI_USERNAME;
const WE_PASSWORD = process.env.DOKKI_PASSWORD;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const TELEGRAM_GROUP_ID = process.env.TELEGRAM_GROUP_ID; // Group chat for colleague
const MAX_RETRIES = 3;

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function randomDelay(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function stripNum(str) {
  if (!str) return null;
  const cleaned = String(str).replace(/,/g, '').replace(/[^\d.\-]/g, '').trim();
  const n = parseFloat(cleaned);
  return isNaN(n) ? null : n;
}

async function withTimeout(promise, ms, name) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${name} timed out after ${ms}ms`)), ms))
  ]);
}

async function tryMethods(methods, stepName, timeout) {
  for (let i = 0; i < methods.length; i++) {
    try {
      console.log(`  [${i+1}/${methods.length}]`);
      const result = await withTimeout(methods[i](), timeout, `${stepName} M${i+1}`);
      console.log(`  âœ“ Method ${i+1} SUCCESS`);
      return result;
    } catch (e) {
      console.log(`  âœ— Method ${i+1} FAILED: ${e.message}`);
      if (i === methods.length - 1) throw new Error(`${stepName} ALL METHODS FAILED`);
      await sleep(500);
    }
  }
}

async function harvestQuota() {
  console.log('ًںڑ€ STARTING...\n');
  let browser, page;

  // â”€â”€ Session Cookie Helpers (Dokki) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  async function loadSavedCookies() {
    try {
      const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/quota_settings/session_dokki?key=${FIREBASE_API_KEY}`;
      const res = await fetch(url);
      if (!res.ok) return null;
      const doc = await res.json();
      const cookieStr = doc?.fields?.cookies?.stringValue;
      const savedAt = doc?.fields?.savedAt?.stringValue;
      if (!cookieStr || !savedAt) return null;
      const age = Date.now() - new Date(savedAt).getTime();
      // Use cookies saved within last 23 hours (extended from 4h to reduce login frequency)
      if (age > 23 * 60 * 60 * 1000) { console.log('  [SESSION] Cookies expired (>23h old), fresh login'); return null; }
      console.log('  [SESSION] Found saved cookies (' + Math.floor(age/60000) + 'm old)');
      return JSON.parse(cookieStr);
    } catch(e) { console.log('  [SESSION] Could not load cookies:', e.message); return null; }
  }

  async function saveCookies(cookies) {
    try {
      const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/quota_settings/session_dokki?key=${FIREBASE_API_KEY}`;
      await fetch(url, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: {
          cookies:  { stringValue: JSON.stringify(cookies) },
          savedAt:  { stringValue: new Date().toISOString() },
          line:     { stringValue: 'dokki' }
        }})
      });
      console.log('  [SESSION] Cookies saved to Firestore âœ“');
    } catch(e) { console.log('  [SESSION] Could not save cookies:', e.message); }
  }

  async function clearCookies() {
    try {
      const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/quota_settings/session_dokki?key=${FIREBASE_API_KEY}`;
      await fetch(url, { method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: { cookies: { stringValue: '' }, savedAt: { stringValue: '' } }})
      });
      console.log('  [SESSION] Cookies cleared');
    } catch(e) {}
  }
  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  try {
    browser = await puppeteer.launch({
      headless: true,
      executablePath: '/usr/bin/google-chrome-stable',
      protocolTimeout: 60000,
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
      // Kill alert/confirm/prompt before site JS runs - prevents "Prohibit use of console" dialog
      window.alert = () => {};
      window.confirm = () => true;
      window.prompt = () => '';
      
      // Protect console from being overridden by site
      Object.defineProperty(window, 'console', {
        writable: false,
        configurable: false
      });
      
      // Existing stealth
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
      window.navigator.chrome = { runtime: {} };
      Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
      Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
    });

    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.setViewport({ width: 1366, height: 768 });

    page.on('dialog', async dialog => {
      console.log('  Dialog dismissed:', dialog.message().slice(0, 80));
      await dialog.accept();
    });

    // â•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گ
    // STEP 0: TRY SAVED SESSION COOKIES
    // â•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گ
    console.log('STEP 0: SESSION CHECK');
    let sessionValid = false;
    const savedCookies = await loadSavedCookies();
    if (savedCookies && savedCookies.length > 0) {
      try {
        console.log('  Trying saved session cookies...');
        await page.setCookie(...savedCookies);
        await page.goto('https://my.te.eg/echannel/#/accountoverview', { waitUntil: 'networkidle2', timeout: 20000 });
        await sleep(3000);
        const url = page.url();
        const isLoggedIn = !url.includes('login') && url.includes('account');
        if (isLoggedIn) {
          sessionValid = true;
          console.log('  âœ“ Session still valid! Skipping login entirely.\n');
          // Keep-alive: refresh savedAt so the 23h clock resets on each successful reuse
          await saveCookies(savedCookies);
        } else {
          console.log('  âœ— Session expired, clearing and doing fresh login');
          await clearCookies();
        }
      } catch(e) {
        console.log('  âœ— Session check failed:', e.message);
        await clearCookies();
      }
    } else {
      console.log('  No saved session, will do fresh login\n');
    }

    // â•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گ
    console.log('STEP 1: NAVIGATE');
    // â•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گ
    if (!sessionValid) {
    await tryMethods([
      // M1: EXACT same as working local harvester
      async () => {
        await page.goto('https://my.te.eg/echannel/', { waitUntil: 'networkidle2', timeout: 30000 });
        await page.waitForFunction(() => document.querySelectorAll('input').length >= 2, { timeout: 15000 });
        console.log('    networkidle2 + wait for 2 inputs (local harvester method)');
      },
      // M2: domcontentloaded + wait for 2 inputs
      async () => {
        await page.goto('https://my.te.eg/echannel/', { waitUntil: 'domcontentloaded', timeout: 40000 });
        await page.waitForFunction(() => document.querySelectorAll('input').length >= 2, { timeout: 20000 });
        console.log('    domcontentloaded + wait for 2 inputs');
      },
      // M3: load + wait for 2 inputs
      async () => {
        await page.goto('https://my.te.eg/echannel/', { waitUntil: 'load', timeout: 40000 });
        await page.waitForFunction(() => document.querySelectorAll('input').length >= 2, { timeout: 20000 });
        console.log('    load + wait for 2 inputs');
      },
      // M4: no wait + long sleep + check inputs
      async () => {
        await page.goto('https://my.te.eg/echannel/', { timeout: 40000 });
        await sleep(15000);
        const count = await page.evaluate(() => document.querySelectorAll('input').length);
        if (count < 1) throw new Error(`Only ${count} inputs found`);
        console.log(`    no wait + 15s sleep, found ${count} inputs`);
      },
      // M5: domcontentloaded + very long sleep
      async () => {
        await page.goto('https://my.te.eg/echannel/', { waitUntil: 'domcontentloaded', timeout: 40000 });
        await sleep(20000);
        console.log('    domcontentloaded + 20s sleep');
      }
    ], 'NAVIGATE', 55000);

    console.log('  URL:', page.url());

    // Dump diagnostics BEFORE username step
    console.log('\n  --- FORM DIAGNOSTICS ---');
    const diag = await withTimeout(page.evaluate(() => {
      const inputs = Array.from(document.querySelectorAll('input'));
      return {
        url: window.location.href,
        inputCount: inputs.length,
        inputs: inputs.map((inp, i) => ({
          i, id: inp.id, name: inp.name, type: inp.type,
          placeholder: inp.placeholder, visible: inp.offsetParent !== null,
          value: inp.value
        })),
        hasAntSelect: !!document.querySelector('.ant-select'),
        hasAntInput: !!document.querySelector('.ant-input'),
        bodyLen: document.body.innerHTML.length
      };
    }), 10000, 'diagnostics');
    console.log('  URL:', diag.url);
    console.log('  Inputs found:', diag.inputCount);
    console.log('  .ant-select:', diag.hasAntSelect, ' .ant-input:', diag.hasAntInput);
    diag.inputs.forEach(inp => console.log(`    [${inp.i}] id="${inp.id}" type="${inp.type}" placeholder="${inp.placeholder}" visible=${inp.visible}`));
    console.log('  --- END DIAGNOSTICS ---\n');

    // Human-like pause before typing
    const delay1 = randomDelay(5000, 8000);
    console.log('  [HUMAN] pause', delay1, 'ms');
    await sleep(delay1);

    // ======================================
    console.log('STEP 2: SERVICE NUMBER (USERNAME)');
    // ======================================
    await tryMethods([
      // M1: EXACT same as working local harvester
      async () => {
        await page.focus('#login_loginid_input_01');
        await sleep(3000);
        await page.type('#login_loginid_input_01', WE_USERNAME, { delay: randomDelay(100, 200) });
        await sleep(3000);
        console.log('    focus + type (local harvester method)');
      },
      // M2: $ find + click + type
      async () => {
        const el = await page.$('#login_loginid_input_01');
        if (!el) throw new Error('ID not found');
        await el.click(); await sleep(3000);
        await el.type(WE_USERNAME, { delay: randomDelay(100, 200) });
        await sleep(3000);
        console.log('    $ find + click + type');
      },
      // M3: .ant-input class
      async () => {
        const els = await page.$$('.ant-input');
        if (!els.length) throw new Error('no .ant-input');
        await els[0].click(); await sleep(3000);
        await els[0].type(WE_USERNAME, { delay: randomDelay(100, 200) });
        await sleep(3000);
        console.log('    .ant-input class');
      },
      // M4: input[type=text]
      async () => {
        const els = await page.$$('input[type="text"]');
        if (!els.length) throw new Error('no text inputs');
        await els[0].click(); await sleep(3000);
        await els[0].type(WE_USERNAME, { delay: randomDelay(100, 200) });
        await sleep(3000);
        console.log('    input[type=text]');
      },
      // M5: DOM evaluate with React-compatible events
      async () => {
        const ok = await page.evaluate((u) => {
          const inp = document.querySelector('#login_loginid_input_01') ||
                      document.querySelector('.ant-input') ||
                      document.querySelector('input[type="text"]') ||
                      document.querySelector('input:not([type="password"]):not([type="hidden"])');
          if (!inp) return false;
          inp.focus();
          const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
          nativeSetter.call(inp, u);
          inp.dispatchEvent(new Event('input', { bubbles: true }));
          inp.dispatchEvent(new Event('change', { bubbles: true }));
          return true;
        }, WE_USERNAME);
        if (!ok) throw new Error('DOM set failed');
        await sleep(3000);
        console.log('    DOM native setter + React events');
      },
      // M6: loop all inputs
      async () => {
        const all = await page.$$('input');
        if (!all.length) throw new Error('no inputs at all');
        for (let i = 0; i < all.length; i++) {
          const info = await all[i].evaluate(el => ({
            type: el.type, visible: el.offsetParent !== null, id: el.id
          }));
          console.log(`    input[${i}] id="${info.id}" type="${info.type}" visible=${info.visible}`);
          if (info.type !== 'password' && info.type !== 'hidden' && info.visible) {
            await all[i].click(); await sleep(3000);
            await all[i].type(WE_USERNAME, { delay: randomDelay(100, 200) });
            await sleep(3000);
            console.log(`    used input[${i}]`);
            return;
          }
        }
        throw new Error('no visible non-password input');
      },
      // M7: keyboard Tab from body
      async () => {
        await page.focus('body');
        await sleep(3000);
        await page.keyboard.press('Tab');
        await sleep(1000);
        await page.keyboard.type(WE_USERNAME, { delay: randomDelay(100, 200) });
        await sleep(3000);
        console.log('    Tab from body + type');
      },
      // M8: click first input regardless of type
      async () => {
        await page.click('input');
        await sleep(3000);
        await page.keyboard.type(WE_USERNAME, { delay: randomDelay(100, 200) });
        await sleep(3000);
        console.log('    click first input + keyboard');
      }
    ], 'SERVICE NUMBER', 60000);

    console.log('  [OK] Service number entered\n');

    // Human-like pause after username
    const delay2 = randomDelay(5000, 8000);
    console.log('  [HUMAN] pause', delay2, 'ms');
    await sleep(delay2);

    // Wait for dropdown/search input to appear after username triggers React re-render
    console.log('  Waiting for service type input to appear...');
    await withTimeout(
      page.waitForFunction(() => !!document.querySelector('#login_input_type_01, .ant-select, .ant-select-selector, [class*="select"]'), { timeout: 15000 }),
      16000, 'dropdown appearance'
    ).catch(() => console.log('  [WARN] Dropdown wait timed out, proceeding anyway'));
    await sleep(1000);

    // Log dropdown state
    const dropdownDiag = await withTimeout(page.evaluate(() => ({
      antSelect: !!document.querySelector('.ant-select'),
      antSelectSelector: !!document.querySelector('.ant-select-selector'),
      searchInput: !!document.querySelector('#login_input_type_01'),
      anySelect: !!document.querySelector('[class*="select"]'),
      selectText: document.querySelector('.ant-select-selector')?.innerText || document.querySelector('#login_input_type_01')?.value || null
    })), 5000, 'dropdown diag').catch(() => null);
    console.log('  Dropdown state:', JSON.stringify(dropdownDiag));

    // ======================================
    console.log('STEP 3: DROPDOWN');
    // ======================================
    await tryMethods([
      // M1: New search-input style (#login_input_type_01) â€” WE updated portal
      async () => {
        const searchInput = await page.$('#login_input_type_01');
        if (!searchInput) throw new Error('search input not found');
        await searchInput.click();
        await sleep(500);
        // Clear and type Internet to trigger dropdown options
        await searchInput.evaluate(el => { el.value = ''; el.dispatchEvent(new Event('input', { bubbles: true })); });
        await searchInput.type('Internet', { delay: 80 });
        await sleep(1000);
        // Click the Internet option from dropdown list
        const clicked = await page.evaluate(() => {
          const opts = Array.from(document.querySelectorAll('.ant-select-item-option, .ant-select-item, li, [class*="option"]'));
          const internet = opts.find(o => o.textContent?.toLowerCase().includes('internet'));
          if (internet) { internet.click(); return internet.textContent.trim(); }
          // Fallback: press Enter if no clickable option found
          return null;
        });
        if (!clicked) {
          await page.keyboard.press('ArrowDown');
          await sleep(300);
          await page.keyboard.press('Enter');
          console.log('    M1: search input + ArrowDown + Enter');
        } else {
          console.log('    M1: search input + clicked:', clicked);
        }
        await sleep(800);
        // Verify selection registered
        const val = await page.evaluate(() => {
          const sel = document.querySelector('.ant-select-selector')?.innerText || '';
          const inp = document.querySelector('#login_input_type_01')?.value || '';
          return sel + inp;
        });
        if (!val.toLowerCase().includes('internet')) throw new Error('Internet not selected, got: ' + val);
      },
      // M2: Classic ant-select click + find option
      async () => {
        await page.waitForFunction(() => !!document.querySelector('.ant-select-selector, .ant-select'), { timeout: 10000 });
        await sleep(500);
        const dropdown = await page.$('.ant-select-selector, .ant-select');
        if (!dropdown) throw new Error('dropdown not found');
        await dropdown.click();
        await sleep(1500);
        const clicked = await page.evaluate(() => {
          const items = Array.from(document.querySelectorAll('.ant-select-item-option, .ant-select-item, li'));
          const internet = items.find(i => i.textContent?.toLowerCase().includes('internet'));
          if (internet) { internet.click(); return internet.textContent.trim(); }
          return null;
        });
        if (!clicked) throw new Error('Internet option not found');
        console.log('    M2: ant-select click, selected:', clicked);
        await sleep(500);
      },
      // M3: Tab from username field + type Internet + Enter
      async () => {
        await page.keyboard.press('Tab');
        await sleep(800);
        // Clear existing value
        await page.keyboard.down('Control');
        await page.keyboard.press('a');
        await page.keyboard.up('Control');
        await sleep(200);
        await page.keyboard.type('Internet', { delay: 80 });
        await sleep(800);
        // Click visible option or press ArrowDown + Enter
        const clicked = await page.evaluate(() => {
          const opts = Array.from(document.querySelectorAll('.ant-select-item-option, li, [class*="option"]'));
          const internet = opts.find(o => o.textContent?.toLowerCase().includes('internet'));
          if (internet) { internet.click(); return true; }
          return false;
        });
        if (!clicked) {
          await page.keyboard.press('ArrowDown');
          await sleep(200);
          await page.keyboard.press('Enter');
        }
        console.log('    M3: Tab + type Internet + select');
        await sleep(500);
      },
      // M4: evaluate native setter on search input
      async () => {
        const ok = await page.evaluate(() => {
          const inp = document.querySelector('#login_input_type_01') ||
                      document.querySelector('input[type="search"]') ||
                      document.querySelector('.ant-select-selection-search-input');
          if (!inp) return false;
          inp.focus();
          const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
          setter.call(inp, 'Internet');
          inp.dispatchEvent(new Event('input', { bubbles: true }));
          inp.dispatchEvent(new Event('change', { bubbles: true }));
          return true;
        });
        if (!ok) throw new Error('native setter failed');
        await sleep(1000);
        await page.evaluate(() => {
          const opts = Array.from(document.querySelectorAll('.ant-select-item-option, li, [class*="option"], div'));
          const internet = opts.find(o => o.textContent?.toLowerCase().includes('internet'));
          if (internet) internet.click();
        });
        await sleep(500);
        console.log('    M4: native setter on search input');
      },
      // M5: broad click any select + type
      async () => {
        await sleep(2000);
        const els = await page.$$('[class*="select"]');
        if (els.length) { await els[0].click(); await sleep(1500); }
        await page.keyboard.type('Internet', { delay: 80 });
        await sleep(800);
        await page.keyboard.press('ArrowDown');
        await sleep(300);
        await page.keyboard.press('Enter');
        console.log('    M5: broad select + type + enter');
        await sleep(500);
      }
    ], 'DROPDOWN', 25000);

    console.log('  [OK] Dropdown done\n');


    // Human-like pause before password
    const delay3 = randomDelay(5000, 8000);
    console.log('  [HUMAN] pause', delay3, 'ms');
    await sleep(delay3);

    // ======================================
    console.log('STEP 4: PASSWORD');
    // ======================================
    await sleep(500);
    await tryMethods([
      async () => {
        await page.focus('#login_password_input_01');
        await sleep(3000);
        await page.type('#login_password_input_01', WE_PASSWORD, { delay: randomDelay(100, 200) });
        await sleep(3000);
        console.log('    focus + type (local harvester method)');
      },
      async () => {
        const el = await page.$('#login_password_input_01');
        if (!el) throw new Error('ID not found');
        await el.click(); await sleep(3000);
        await el.type(WE_PASSWORD, { delay: randomDelay(100, 200) });
        await sleep(3000);
        console.log('    $ find + click + type');
      },
      async () => {
        const els = await page.$$('input[type="password"]');
        if (!els.length) throw new Error('no password inputs');
        await els[0].click(); await sleep(3000);
        await els[0].type(WE_PASSWORD, { delay: randomDelay(100, 200) });
        await sleep(3000);
        console.log('    input[type=password]');
      },
      async () => {
        const ok = await page.evaluate((p) => {
          const inp = document.querySelector('#login_password_input_01') ||
                      document.querySelector('input[type="password"]');
          if (!inp) return false;
          const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
          nativeSetter.call(inp, p);
          inp.dispatchEvent(new Event('input', { bubbles: true }));
          inp.dispatchEvent(new Event('change', { bubbles: true }));
          return true;
        }, WE_PASSWORD);
        if (!ok) throw new Error('DOM set failed');
        console.log('    DOM native setter');
      },
      async () => {
        const all = await page.$$('input');
        for (let i = 0; i < all.length; i++) {
          const type = await all[i].evaluate(el => el.type);
          if (type === 'password') {
            await all[i].click(); await sleep(3000);
            await all[i].type(WE_PASSWORD, { delay: randomDelay(100, 200) });
            await sleep(3000);
            console.log(`    loop found password at input[${i}]`);
            return;
          }
        }
        throw new Error('no password input in loop');
      }
    ], 'PASSWORD', 60000);

    console.log('  [OK] Password done\n');

    // Human-like pause before submit
    const delay4 = randomDelay(5000, 8000);
    console.log('  [HUMAN] pause', delay4, 'ms');
    await sleep(delay4);

    // ======================================
    console.log('STEP 5: SUBMIT');
    // ======================================
    await tryMethods([
      async () => {
        await page.evaluate(() => {
          const btns = Array.from(document.querySelectorAll('button'));
          const btn = btns.find(b => b.textContent.toLowerCase().includes('login') || b.className.includes('primary'));
          if (btn) btn.click();
        });
        await sleep(6000);
        console.log('    local harvester method');
      },
      async () => {
        await page.keyboard.press('Enter');
        await sleep(10000);
        console.log('    press Enter');
      },
      async () => {
        const btns = await page.$$('button');
        if (btns.length) await btns[0].click();
        await sleep(10000);
        console.log('    first button');
      },
      async () => {
        await page.click('button[type="submit"]').catch(() => {});
        await sleep(10000);
        console.log('    submit button');
      },
      async () => {
        await page.evaluate(() => { document.querySelector('form')?.submit(); });
        await sleep(10000);
        console.log('    form.submit()');
      }
    ], 'SUBMIT', 20000);

    // ======================================
    // POST-SUBMIT: Race - URL change vs captcha modal vs block
    // ======================================
    console.log('  Waiting for login result...');
    let postLoginState = 'unknown';
    for (let tick = 0; tick < 20; tick++) {
      const currentUrl = page.url();
      if (!currentUrl.includes('login')) {
        postLoginState = 'navigated';
        console.log('  [OK] URL changed to:', currentUrl);
        break;
      }
      const pageState = await page.evaluate(() => {
        const modal = document.querySelector('.ant-modal-content, .ant-modal, [class*="modal"], [class*="verification"]');
        const text = document.body.innerText.toLowerCase();
        const hasCaptcha = !!modal || text.includes('verification') || text.includes('enter code');
        const isBlocked = text.includes('maximum') || text.includes('too many') ||
                          text.includes('exceeded') || text.includes('try again') ||
                          text.includes('blocked') || text.includes('ظ…ط­ط§ظˆظ„ط§طھ') ||
                          text.includes('ط§ظ„ط­ط¯ ط§ظ„ط§ظ‚طµظ‰') || text.includes('ظ…ط±ظ‡ ط§ط®ط±ظ‰');
        return { hasCaptcha, isBlocked, text: text.slice(0, 200) };
      });
      if (pageState.isBlocked) {
        postLoginState = 'blocked';
        console.log('  [BLOCKED] WE has blocked this IP/account temporarily');
        console.log('  [BLOCKED] Page text:', pageState.text.slice(0, 150));
        break;
      }
      if (pageState.hasCaptcha) {
        postLoginState = 'captcha';
        console.log('  [CAPTCHA] Modal detected at', tick + 1, 'seconds');
        break;
      }
      if (tick % 3 === 0) console.log('  Waiting...', tick + 1, 's');
      await sleep(1000);
    }

    if (postLoginState === 'blocked') {
      await clearCookies();
      throw new Error('WE_BLOCKED: Account/IP temporarily blocked. Will auto-retry on next scheduled run.');
    }

    if (postLoginState === 'unknown') {
      throw new Error('Still on login page - no navigation or captcha after 20s');
    }

    // ======================================
    // ======================================
    // CAPTCHA ENGINE v5 â€” OCR.space (primary) + Tesseract (fallback)
    // MAX 4 submissions â€” block-safe (WE blocks after ~6 wrong attempts)
    // ======================================
    if (postLoginState === 'captcha') {
      console.log('  [CAPTCHA] Engine v5 â€” OCR.space + Tesseract, max 4 submissions\n');

      // â”€â”€ Fetch captcha image via XHR (uses session cookies, bypasses headless block) â”€â”€
      async function fetchCaptchaBase64() {
        try {
          const imgSrc = await page.evaluate(() => {
            const modal = document.querySelector('.ant-modal-content, .ant-modal, [class*="modal"]');
            if (!modal) return null;
            const imgs = Array.from(modal.querySelectorAll('img')).sort((a,b)=>{
              const aR=a.getBoundingClientRect(),bR=b.getBoundingClientRect();
              return (bR.width*bR.height)-(aR.width*aR.height);
            });
            for (const img of imgs) {
              const r = img.getBoundingClientRect();
              if (r.width > 80 && r.height > 25) return img.src || img.getAttribute('src');
            }
            return imgs[0]?.src || null;
          });
          if (!imgSrc) return null;
          if (imgSrc.startsWith('data:image')) return imgSrc;
          const b64 = await page.evaluate(async (url) => new Promise(resolve => {
            const xhr = new XMLHttpRequest();
            xhr.open('GET', url, true); xhr.responseType = 'blob';
            xhr.onload = () => { const r=new FileReader(); r.onloadend=()=>resolve(r.result); r.readAsDataURL(xhr.response); };
            xhr.onerror = xhr.ontimeout = () => resolve(null);
            xhr.timeout = 8000; xhr.send();
          }), imgSrc);
          return b64 || null;
        } catch(e) { console.log('    [fetch] err:', e.message); return null; }
      }

      // â”€â”€ OCR.space API â€” primary â”€â”€
      async function ocrSpaceRead(imageData) {
        try {
          const apiKey = process.env.OCR_SPACE_API_KEY || 'helloworld';
          const base64 = imageData.includes(',') ? imageData.split(',')[1] : imageData;
          const body = new URLSearchParams({
            base64Image: 'data:image/png;base64,' + base64,
            apikey: apiKey, language: 'eng', isOverlayRequired: 'false',
            detectOrientation: 'false', scale: 'true', OCREngine: '2', isTable: 'false'
          });
          const res = await fetch('https://api.ocr.space/parse/image', {
            method: 'POST', body: body.toString(),
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
          });
          if (!res.ok) { console.log('    [OCR.space] HTTP', res.status); return []; }
          const json = await res.json();
          if (json.IsErroredOnProcessing) { console.log('    [OCR.space] API error:', json.ErrorMessage?.[0]); return []; }
          const text = (json.ParsedResults?.[0]?.ParsedText || '').replace(/[^A-Za-z0-9]/g, '').trim();
          console.log('    [OCR.space] result:', text);
          return text ? [text] : [];
        } catch(e) { console.log('    [OCR.space] err:', e.message); return []; }
      }

      // â”€â”€ Tesseract fallback â”€â”€
      async function findCaptchaImg() {
        return await page.evaluateHandle(() => {
          const modal = document.querySelector('.ant-modal-content, .ant-modal, [class*="modal"]');
          if (!modal) return null;
          const imgs = Array.from(modal.querySelectorAll('img')).sort((a,b)=>{
            const aR=a.getBoundingClientRect(),bR=b.getBoundingClientRect();
            return (bR.width*bR.height)-(aR.width*aR.height);
          });
          for (const img of imgs) { const r=img.getBoundingClientRect(); if(r.width>80&&r.height>25) return img; }
          return imgs[0]||null;
        });
      }

      async function canvasProcess(imgHandle, filter) {
        return await page.evaluate((imgEl, f) => {
          if (!imgEl || !imgEl.naturalWidth) return null;
          const s=3, c=document.createElement('canvas');
          c.width=imgEl.naturalWidth*s; c.height=imgEl.naturalHeight*s;
          const ctx=c.getContext('2d'); ctx.imageSmoothingEnabled=false;
          ctx.drawImage(imgEl,0,0,c.width,c.height);
          const data=ctx.getImageData(0,0,c.width,c.height), d=data.data;
          for (let i=0;i<d.length;i+=4) {
            const r=d[i],g=d[i+1],b=d[i+2];
            let keep=false;
            if(f==='red') keep=r>100&&(r-g)>30&&(r-b)>30;
            else if(f==='dark') keep=(0.299*r+0.587*g+0.114*b)<140;
            else { const mx=Math.max(r,g,b),mn=Math.min(r,g,b); keep=mx>0&&(mx-mn)/mx>0.3&&r>g; }
            d[i]=d[i+1]=d[i+2]=keep?0:255;
          }
          ctx.putImageData(data,0,0); return c.toDataURL('image/png');
        }, imgHandle, filter);
      }

      async function tesseractRead(imageData) {
        const Tesseract = require('tesseract.js');
        const opts = { tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789' };
        const r1 = await Tesseract.recognize(imageData, 'eng', { ...opts, tessedit_pageseg_mode: '8' });
        const t1 = r1.data.text.replace(/[^A-Za-z0-9]/g,'').trim();
        const results = t1 ? [t1] : [];
        if (t1.length !== 5) {
          const r2 = await Tesseract.recognize(imageData, 'eng', { ...opts, tessedit_pageseg_mode: '7' });
          const t2 = r2.data.text.replace(/[^A-Za-z0-9]/g,'').trim();
          if (t2 && t2 !== t1) results.push(t2);
        }
        return results;
      }

      // â”€â”€ Submit answer â”€â”€
      async function submitAnswer(answer) {
        console.log('    -> Submitting:', answer);
        const ok = await page.evaluate((ans) => {
          const modal = document.querySelector('.ant-modal-content, .ant-modal, [class*="modal"]');
          if (!modal) return false;
          const inp = modal.querySelector('input.ant-input, input[type="text"]');
          if (!inp) return false;
          inp.focus(); inp.click();
          const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;
          setter.call(inp,''); inp.dispatchEvent(new Event('input',{bubbles:true}));
          setter.call(inp,ans); inp.dispatchEvent(new Event('input',{bubbles:true}));
          inp.dispatchEvent(new Event('change',{bubbles:true}));
          const allBtns = Array.from(modal.querySelectorAll('button'));
          const btn = allBtns.find(b=>/ok|confirm|submit/i.test(b.textContent)) ||
                      modal.querySelector('button.ant-btn-primary') ||
                      allBtns[allBtns.length-1];
          if (btn) btn.click();
          return true;
        }, answer);
        if (!ok) {
          await page.keyboard.press('Tab'); await sleep(200);
          await page.keyboard.type(answer, {delay:40}); await sleep(300);
          await page.keyboard.press('Enter');
        }
        await sleep(5000);
        return !page.url().includes('login');
      }

      async function isModalOpen() {
        return await page.evaluate(()=>!!document.querySelector('.ant-modal-content,.ant-modal,[class*="modal"]'));
      }

      // â•گâ•گ MAIN LOOP â€” max 4 submissions â•گâ•گ
      const MAX_SUBS = 4;
      let captchaSolved = false;
      let subCount = 0;

      for (let round = 1; round <= MAX_SUBS && !captchaSolved; round++) {
        console.log('\n  -- Round ' + round + '/' + MAX_SUBS + ' (submitted so far: ' + subCount + ') --');

        if (round > 1) {
          let found = false;
          for (let w = 0; w < 10; w++) {
            await sleep(1000);
            if (await isModalOpen()) { found = true; break; }
            if (!page.url().includes('login')) { captchaSolved = true; break; }
          }
          if (captchaSolved) break;
          if (!found) {
            await page.evaluate(()=>{
              const btn=Array.from(document.querySelectorAll('button')).find(b=>b.textContent.toLowerCase().includes('login')||b.className.includes('primary'));
              if(btn)btn.click();
            });
            await sleep(3000);
            if (!await isModalOpen()) {
              if (!page.url().includes('login')) { captchaSolved = true; break; }
              console.log('    ! No modal â€” skipping round'); continue;
            }
          }
          await sleep(1000);
        }

        try {
          // Fetch image
          let imageData = null;
          for (let retry = 0; retry < 4; retry++) {
            imageData = await fetchCaptchaBase64();
            if (imageData) break;
            await sleep(2000);
          }
          if (!imageData) { console.log('    ! No image fetched â€” skipping (no submission wasted)'); continue; }

          // Get best answer â€” try all methods
          let bestAnswer = '';

          // M1: OCR.space (best)
          const ocrRes = await ocrSpaceRead(imageData);
          const ocrMatch = ocrRes.find(t=>t.length===5) || ocrRes.find(t=>t.length>=4) || '';
          if (ocrMatch) { bestAnswer = ocrMatch; console.log('    [OCR.space] using:', bestAnswer); }

          // M2: Tesseract canvas filters
          if (!bestAnswer) {
            const imgH = await findCaptchaImg();
            if (imgH) {
              for (const f of ['red','dark','contrast']) {
                const b64 = await canvasProcess(imgH, f);
                if (!b64) continue;
                const txts = await tesseractRead(b64);
                const m = txts.find(t=>t.length===5);
                console.log('    [tesseract-' + f + ']:', JSON.stringify(txts), m?'[OK]':'[SKIP]');
                if (m) { bestAnswer = m; break; }
              }
            }
          }

          // M3: Tesseract raw image
          if (!bestAnswer) {
            const txts = await tesseractRead(imageData);
            const m = txts.find(t=>t.length===5) || txts.find(t=>t.length>=4) || '';
            console.log('    [tesseract-raw]:', JSON.stringify(txts), m?'[OK]':'[SKIP]');
            if (m) bestAnswer = m;
          }

          // No answer found â€” skip submission to protect block limit
          if (!bestAnswer) {
            console.log('    ! No answer from any method â€” skipping (block protection)');
            continue;
          }

          // Apply case variant
          const variant = ['orig','UPPER','lower'][(round-1)%3];
          const attempt = variant==='UPPER' ? bestAnswer.toUpperCase() : variant==='lower' ? bestAnswer.toLowerCase() : bestAnswer;
          console.log('    -> [' + variant + '] "' + attempt + '" â€” attempt ' + (subCount+1) + '/' + MAX_SUBS);

          subCount++;
          captchaSolved = await submitAnswer(attempt);
          if (captchaSolved) {
            console.log('  >>> CAPTCHA SOLVED round ' + round + '! <<<');
          } else {
            console.log('    X Wrong. Remaining safe attempts: ' + (MAX_SUBS - subCount));
          }

        } catch(e) { console.log('    ! Round error:', e.message); }
      }

      // Close modal gracefully â€” never leave it open
      if (!captchaSolved) {
        console.log('  [CAPTCHA] ' + subCount + ' attempts used â€” closing modal safely (block protection)');
        await page.evaluate(()=>{
          const modal=document.querySelector('.ant-modal-content,.ant-modal,[class*="modal"]');
          const btn=modal?.querySelector('button');
          if(btn)btn.click();
        });
        await sleep(2000);
        throw new Error('CAPTCHA_UNSOLVED: ' + subCount + '/4 attempts. Next run will retry fresh.');
      }
    }

    // â•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گ
    console.log('STEP 2: SERVICE NUMBER (USERNAME)');
    // â•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گ
    console.log('  âœ“ Login successful!\n');

    // Save session cookies for next run
    try {
      const cookies = await page.cookies();
      const relevantCookies = cookies.filter(c => c.domain.includes('te.eg') || c.domain.includes('telecomegypt'));
      if (relevantCookies.length > 0) await saveCookies(relevantCookies);
    } catch(e) { console.log('  [SESSION] Could not save cookies:', e.message); }

    } // end if (!sessionValid)


    // â•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گ
    console.log('STEP 5.5: LINE SWITCHER (Dokki)');
    // â•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گ
    console.log('  Switching to line 0237600094...');

    // CRITICAL: The WE portal does a session refresh after line switch that can
    // redirect back to #/login within seconds. The only reliable approach is to
    // extract the data THE MOMENT we confirm the correct page is showing â€”
    // before the redirect can happen. We capture data inside the switcher itself.

    // Helper: extract all quota data from the current page state
    async function extractNow() {
      const result = await page.evaluate(() => {
        const spans = Array.from(document.querySelectorAll('span, div, p'));
        let remaining = null, used = null, balance = null, plan = null;
        function isNumericText(t) {
          if (!t) return false;
          const s = t.replace(/,/g, '').trim();
          return /^\d+(\.\d+)?$/.test(s) && !s.startsWith('0237') && !s.startsWith('023');
        }
        for (let i = 0; i < spans.length; i++) {
          const t = spans[i].innerText?.trim();
          if (!t || t.length > 100) continue;
          if (t === 'Remaining') {
            for (let b = 1; b <= 3; b++) {
              const c = spans[i-b]?.innerText?.trim();
              if (isNumericText(c)) { remaining = c; break; }
            }
          }
          if (t === 'Used') {
            for (let b = 1; b <= 3; b++) {
              const c = spans[i-b]?.innerText?.trim();
              if (isNumericText(c)) { used = c; break; }
            }
          }
          if (t === 'Current Balance') {
            for (let f = 1; f <= 5; f++) {
              const c = spans[i+f]?.innerText?.trim();
              if (isNumericText(c)) { balance = c; break; }
            }
          }
          if (t.includes('GB') && t.toLowerCase().includes('speed')) plan = t;
        }
        if (!remaining) {
          // Fallback: regex on full page text
          const text = document.body.innerText;
          const r = text.match(/([\d,]+\.?\d+)\s*\n?\s*Remaining/i);
          const u = text.match(/([\d,]+\.?\d+)\s*\n?\s*Used/i);
          const b = text.match(/Current Balance\s*\n?\s*([\d,]+\.?\d+)/i) || text.match(/([\d,]+\.?\d+)\s*EGP/i);
          const p = text.match(/[^\n]*\d+\s*GB[^\n]*[Ss]peed[^\n]*/);
          if (!r) return null;
          return { remaining: r[1], used: u?.[1]||'0', balance: b?.[1]||'0', plan: p?.[0]?.trim()||'Unknown' };
        }
        return { remaining, used: used||'0', balance: balance||'0', plan: plan||'Unknown' };
      });
      if (!result) return null;
      const parsed = {
        remaining: stripNum(result.remaining),
        used: stripNum(result.used) || 0,
        balance: stripNum(result.balance) || 0,
        plan: result.plan
      };
      return (parsed.remaining || parsed.remaining === 0) ? parsed : null;
    }

    // Helper: check page is showing correct line with actual data
    // IMPORTANT: checks the ACTIVE line widget (top-left "You are currently managing")
    // NOT just text.includes() which can false-positive from hidden dropdown options
    async function checkPage094() {
      return await page.evaluate(() => {
        // Method 1: Check the active line widget specifically
        // The "You are currently managing" shows the ACTIVE line number
        const activeEl = document.querySelector(
          '#accountOverview_currentNumber, .ant-select-selection-item, [class*="currentNumber"], [class*="current-number"]'
        );
        const activeText = activeEl ? activeEl.innerText?.trim() : '';

        // Method 2: Check the small line number display near "You are currently managing"
        const managingEls = Array.from(document.querySelectorAll('span, div'));
        let managingLine = '';
        for (let i = 0; i < managingEls.length; i++) {
          const t = managingEls[i].innerText?.trim();
          if (t && t.includes('currently managing')) {
            // The line number is usually in a nearby sibling or child
            const nearby = managingEls[i+1]?.innerText?.trim() || managingEls[i+2]?.innerText?.trim() || '';
            if (nearby.includes('023760009')) { managingLine = nearby; break; }
            // Also check children
            const child = managingEls[i].querySelector('[class*="number"], [class*="select"]');
            if (child) { managingLine = child.innerText?.trim(); break; }
          }
        }

        // Method 3: Look for 0237600094 specifically in small/label elements (not huge containers)
        let foundIn094Widget = false;
        for (const el of document.querySelectorAll('span, a, button, label, .ant-select-selection-item')) {
          const t = el.innerText?.trim();
          if (t && t.includes('0237600094') && t.length < 20) {
            foundIn094Widget = true;
            break;
          }
        }

        const rem = document.body.innerText.match(/([\d,]+\.?\d+)\s*\n?\s*Remaining/i)?.[1] || '';
        const bal = document.body.innerText.match(/Current Balance\s*\n?\s*([\d,]+\.?\d+)/i)?.[1]
                 || document.body.innerText.match(/([\d,]+\.?\d+)\s*EGP/i)?.[1] || '0';
        const balNum = parseFloat(bal.replace(/,/g, '')) || 0;

        // Line 0237600094 has balance > 3000 EGP (line 0237600093 has ~1923 EGP)
        const isCorrectByBalance = balNum > 3000;

        const has094 = activeText.includes('0237600094') || managingLine.includes('0237600094') || foundIn094Widget || isCorrectByBalance;

        return {
          has094,
          activeText,
          managingLine,
          foundIn094Widget,
          isCorrectByBalance,
          balNum,
          rem,
          hasRemaining: !!rem
        };
      }).catch(() => ({ has094: false, activeText: '', managingLine: '', foundIn094Widget: false, isCorrectByBalance: false, balNum: 0, rem: '', hasRemaining: false }));
    }

    // The captured data from inside the switcher (avoids race condition)
    let switcherCapturedData = null;

    await tryMethods([
      // M1: Click dropdown â†’ select 0237600094 â†’ capture data immediately on confirmation
      async () => {
        await page.waitForFunction(() => {
          const t = document.body.innerText;
          return t.includes('currently managing') || t.includes('Remaining');
        }, { timeout: 15000 });
        await sleep(1500);
        console.log('    Pre-switch URL:', page.url());

        // Open the line switcher dropdown
        const dropdowns = await page.$$('.ant-select-selector, .ant-select');
        if (!dropdowns.length) throw new Error('Dropdown not found');
        await dropdowns[0].click();
        await sleep(1500);

        // Click 0237600094
        const clicked = await page.evaluate(() => {
          const opts = Array.from(document.querySelectorAll(
            '.ant-select-item-option-content, .ant-select-item, li, option'
          ));
          const t = opts.find(o => o.textContent && o.textContent.includes('0237600094'));
          if (t) { t.click(); return t.textContent.trim(); }
          return null;
        });
        if (!clicked) throw new Error('Option 0237600094 not found');
        console.log('    Clicked:', clicked);

        // Poll aggressively â€” capture data THE MOMENT the page shows 0237600094 AND full data loaded
        for (let w = 0; w < 30; w++) {
          await sleep(1000);
          const url = page.url();
          const check = await checkPage094();

          // If stuck on login after 5s, fail this method
          if (url.includes('#/login') && w > 5) throw new Error('Redirected to login after line switch');

          // CRITICAL: Must satisfy ALL conditions for valid capture:
          // 1. check.hasRemaining = true (data visible)
          // 2. check.has094 = true (correct line showing)
          // 3. balance > 3000 (line 94 has ~9856 EGP, line 93 has ~1923 EGP)
          // 4. balance > 0 (data fully loaded, not still loading)
          // 5. plan !== 'Unknown' (full page rendered)
          // 6. remaining + used > 300 GB (line 94 = 750GB plan, line 93 = 250GB plan)
          //    This catches mixed-state where balance updated but remaining/used still from line 93
          if (check.hasRemaining && check.has094) {
            const captured = await extractNow();
            if (captured) {
              const totalGB = (captured.remaining || 0) + (captured.used || 0);
              if (captured.balance > 3000 && captured.balance > 0 && captured.plan !== 'Unknown' && totalGB > 300) {
                switcherCapturedData = captured;
                console.log('    âœ“ M1 FULL DATA CAPTURED: remaining=' + captured.remaining + ' used=' + captured.used + ' total=' + totalGB.toFixed(1) + 'GB balance=' + captured.balance + ' plan=' + captured.plan);
                return; // SUCCESS
              } else if (captured.balance > 0 && captured.balance < 3000) {
                console.log('    âڑ  (' + (w+1) + 's) Balance ' + captured.balance + ' < 3000 â€” WRONG LINE (093), waiting for 094...');
              } else if (captured.balance === 0) {
                console.log('    âڈ³ (' + (w+1) + 's) Balance=0, page still loading... rem=' + captured.remaining);
              } else if (captured.plan === 'Unknown') {
                console.log('    âڈ³ (' + (w+1) + 's) Plan=Unknown, page still rendering... rem=' + captured.remaining + ' bal=' + captured.balance);
              } else if (totalGB <= 300) {
                console.log('    âڑ  (' + (w+1) + 's) MIXED STATE: balance=' + captured.balance + ' (094âœ“) but rem+used=' + totalGB.toFixed(1) + 'GB (093 plan=250GB!) â€” waiting for full 094 data...');
              } else {
                console.log('    âڈ³ (' + (w+1) + 's) Data incomplete, waiting... rem=' + captured.remaining + ' bal=' + captured.balance + ' total=' + totalGB.toFixed(1));
              }
            } else {
              console.log('    âڈ³ (' + (w+1) + 's) extractNow returned null, waiting...');
            }
          } else {
            console.log('    âڈ³ (' + (w+1) + 's) URL:' + url.split('#')[1] + ' | has094:' + check.has094 + ' | hasRem:' + check.hasRemaining + ' | bal:' + check.balNum);
          }
        }
        throw new Error('M1: Page did not show line 94 FULL data (balance>3000, totalGB>300, plan loaded) in 30s');
      },

      // M2: Broad evaluate click â†’ same capture strategy
      async () => {
        await sleep(2000);
        // Try all possible selectors for the dropdown
        await page.evaluate(() => {
          // Try ant-select first
          const sel = document.querySelector('.ant-select-selector, .ant-select');
          if (sel) sel.click();
        });
        await sleep(1500);
        // Click target line
        await page.evaluate(() => {
          for (const el of document.querySelectorAll('div, li, option, span, a, .ant-select-item')) {
            if (el.textContent && el.textContent.trim().includes('0237600094')) { el.click(); return; }
          }
        });
        console.log('    Broad click done, waiting for page...');

        // Same aggressive capture strategy with ALL verification criteria
        for (let w = 0; w < 25; w++) {
          await sleep(1000);
          const url = page.url();
          const check = await checkPage094();

          if (url.includes('#/login') && w > 5) throw new Error('Redirected to login');

          // ALL 6 conditions must be true for valid capture
          if (check.hasRemaining && check.has094) {
            const captured = await extractNow();
            if (captured) {
              const totalGB = (captured.remaining || 0) + (captured.used || 0);
              if (captured.balance > 3000 && captured.balance > 0 && captured.plan !== 'Unknown' && totalGB > 300) {
                switcherCapturedData = captured;
                console.log('    âœ“ M2 FULL DATA CAPTURED: remaining=' + captured.remaining + ' total=' + totalGB.toFixed(1) + 'GB balance=' + captured.balance);
                return;
              } else if (captured.balance > 0 && captured.balance < 3000) {
                console.log('    âڑ  (' + (w+1) + 's) Balance ' + captured.balance + ' < 3000 â€” WRONG LINE (093)');
              } else if (captured.balance === 0) {
                console.log('    âڈ³ (' + (w+1) + 's) Balance=0, loading... rem=' + captured.remaining);
              } else if (captured.plan === 'Unknown') {
                console.log('    âڈ³ (' + (w+1) + 's) Plan=Unknown, rendering... rem=' + captured.remaining + ' bal=' + captured.balance);
              } else if (totalGB <= 300) {
                console.log('    âڑ  (' + (w+1) + 's) MIXED STATE: balance=' + captured.balance + 'âœ“ but total=' + totalGB.toFixed(1) + 'GB = 093 plan, waiting...');
              }
            }
          } else {
            console.log('    âڈ³ (' + (w+1) + 's) rem:' + check.rem + ' | has094:' + check.has094 + ' | bal:' + check.balNum);
          }
        }
        throw new Error('M2: Page did not show line 94 FULL data (balance>3000, totalGB>300, plan loaded) in 25s');
      },

      // M3: page.select() + capture
      async () => {
        await sleep(2000);
        await page.select('select', '0237600094').catch(() => {});
        for (let w = 0; w < 25; w++) {
          await sleep(1000);
          const url = page.url();
          const check = await checkPage094();

          if (url.includes('#/login') && w > 5) throw new Error('Redirected to login');

          // ALL 6 conditions must be true for valid capture
          if (check.hasRemaining && check.has094) {
            const captured = await extractNow();
            if (captured) {
              const totalGB = (captured.remaining || 0) + (captured.used || 0);
              if (captured.balance > 3000 && captured.balance > 0 && captured.plan !== 'Unknown' && totalGB > 300) {
                switcherCapturedData = captured;
                console.log('    âœ“ M3 FULL DATA CAPTURED: remaining=' + captured.remaining + ' total=' + totalGB.toFixed(1) + 'GB balance=' + captured.balance);
                return;
              } else if (captured.balance > 0 && captured.balance < 3000) {
                console.log('    âڑ  (' + (w+1) + 's) Balance ' + captured.balance + ' < 3000 â€” WRONG LINE (093)');
              } else if (captured.balance === 0) {
                console.log('    âڈ³ (' + (w+1) + 's) Balance=0, loading... rem=' + captured.remaining);
              } else if (captured.plan === 'Unknown') {
                console.log('    âڈ³ (' + (w+1) + 's) Plan=Unknown, rendering... rem=' + captured.remaining + ' bal=' + captured.balance);
              } else if (totalGB <= 300) {
                console.log('    âڑ  (' + (w+1) + 's) MIXED STATE: balance=' + captured.balance + 'âœ“ but total=' + totalGB.toFixed(1) + 'GB = 093 plan, waiting...');
              }
            }
          } else {
            console.log('    âڈ³ (' + (w+1) + 's) rem:' + check.rem + ' | has094:' + check.has094 + ' | bal:' + check.balNum);
          }
        }
        throw new Error('M3: Page did not show line 94 FULL data (balance>3000, totalGB>300, plan loaded) in 25s');
      }
    ], 'LINE SWITCHER', 45000);

    console.log('  âœ“ Switched to 0237600094 | captured data:', switcherCapturedData ? 'YES' : 'NO');
    console.log('  Current URL:', page.url(), '\n');

    // â•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گ
    console.log('STEP 6: EXTRACT');
    // â•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گ

    // Use pre-captured data from switcher if available (avoids race condition with redirect)
    // Only fall through to live extraction if switcher didn't capture data
    const data = switcherCapturedData ? await (async () => {
      console.log('  [FAST PATH] Using data captured during line switch (race-condition safe)');
      console.log('    M1 numeric-only sibling scan');
      return switcherCapturedData;
    })() : await tryMethods([
      // M1: Walk ALL spans/divs â€” numeric sibling scan
      async () => {
        await sleep(2000);
        const result = await page.evaluate(() => {
          const spans = Array.from(document.querySelectorAll('span, div, p'));
          let remaining = null, used = null, balance = null, plan = null;
          function isNumericText(t) {
            if (!t) return false;
            const s = t.replace(/,/g, '').trim();
            return /^\d+(\.\d+)?$/.test(s) && !s.startsWith('0237') && !s.startsWith('023');
          }
          for (let i = 0; i < spans.length; i++) {
            const t = spans[i].innerText?.trim();
            if (!t || t.length > 100) continue;
            if (t === 'Remaining') { for (let b=1;b<=3;b++) { const c=spans[i-b]?.innerText?.trim(); if(isNumericText(c)){remaining=c;break;} } }
            if (t === 'Used')      { for (let b=1;b<=3;b++) { const c=spans[i-b]?.innerText?.trim(); if(isNumericText(c)){used=c;break;} } }
            if (t === 'Current Balance') { for (let f=1;f<=5;f++) { const c=spans[i+f]?.innerText?.trim(); if(isNumericText(c)){balance=c;break;} } }
            if (t.includes('GB') && t.toLowerCase().includes('speed')) plan = t;
          }
          if (!remaining) throw new Error('no remaining found');
          return { remaining, used: used||'0', balance: balance||'0', plan: plan||'Unknown' };
        });
        const parsed = { remaining: stripNum(result.remaining), used: stripNum(result.used)||0, balance: stripNum(result.balance)||0, plan: result.plan };
        if (!parsed.remaining && parsed.remaining !== 0) throw new Error('no data after stripNum');
        console.log('    M1 numeric-only sibling scan');
        return parsed;
      },
      // M2: Full page text regex
      async () => {
        await sleep(5000);
        const result = await page.evaluate(() => {
          const text = document.body.innerText;
          const r = text.match(/([\d,]+\.?\d+)\s*\n?\s*Remaining/i);
          const u = text.match(/([\d,]+\.?\d+)\s*\n?\s*Used/i);
          const b = text.match(/Current Balance\s*\n?\s*([\d,]+\.?\d+)/i) || text.match(/([\d,]+\.?\d+)\s*EGP/i);
          const p = text.match(/[^\n]*\d+\s*GB[^\n]*[Ss]peed[^\n]*/);
          if (!r) throw new Error('no remaining in page text');
          return { remaining: r[1], used: u?.[1]||'0', balance: b?.[1]||'0', plan: p?.[0]?.trim()||'Unknown' };
        });
        const parsed = { remaining: stripNum(result.remaining), used: stripNum(result.used)||0, balance: stripNum(result.balance)||0, plan: result.plan };
        if (!parsed.remaining) throw new Error('no data M2');
        console.log('    M2 page text regex');
        return parsed;
      },
      // M3: HTML source regex fallback
      async () => {
        await sleep(8000);
        const html = await withTimeout(page.content(), 8000, 'page.content');
        const r = html.match(/>([\d,]+\.?\d+)<[^>]*>\s*(?:<[^>]*>)*\s*Remaining/i);
        const u = html.match(/>([\d,]+\.?\d+)<[^>]*>\s*(?:<[^>]*>)*\s*Used/i);
        const b = html.match(/>([\d,]+\.?\d+)\s*EGP</i);
        if (!r) throw new Error('no data in html');
        return { remaining: stripNum(r[1]), used: stripNum(u?.[1])||0, balance: stripNum(b?.[1])||0, plan: 'Unknown' };
      }
    ], 'EXTRACT', 30000);

    console.log('  Remaining:', data.remaining, 'GB');
    console.log('  Used:', data.used, 'GB');
    console.log('  Balance:', data.balance, 'EGP');
    console.log('  Plan:', data.plan, '\n');

    // â•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گ
    console.log('STEP 7: FIRESTORE');
    // â•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گ
    const now = new Date().toISOString();
    const fields = {
      'dokki': { mapValue: { fields: {
        quota:    { doubleValue: data.remaining },
        maxQuota: { doubleValue: data.remaining + data.used },
        balance:  { doubleValue: data.balance },
        used:     { doubleValue: data.used },
        plan:     { stringValue: data.plan },
        updatedAt: { stringValue: now },
        updatedBy: { stringValue: 'GitHub Cloud âڑ، Dokki' },
        status:   { stringValue: 'success' }
      }}},
      lastUpdate: { stringValue: now }
    };

    await tryMethods([
      async () => {
        const mask = 'updateMask.fieldPaths=dokki&updateMask.fieldPaths=lastUpdate';
        const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/quota_latest/current?key=${FIREBASE_API_KEY}&${mask}`;
        const res = await fetch(url, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fields }) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        console.log('    updateMask PATCH (Dokki field)');
      },
      async () => {
        await sleep(2000);
        const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/quota_latest/current?key=${FIREBASE_API_KEY}`;
        const res = await fetch(url, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fields }) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        console.log('    standard PATCH');
      },
      async () => {
        await sleep(3000);
        const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/quota_latest/current?key=${FIREBASE_API_KEY}`;
        const res = await fetch(url, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fields }) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        console.log('    retry PATCH');
      }
    ], 'FIRESTORE', 20000);

    console.log('  âœ“ Uploaded to quota_latest!\n');

    // â•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گ
    console.log('STEP 8: LEDGER (quota_history)');
    // â•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گ
    const historyFields = {
      timestamp: { stringValue: now },
      user: { stringValue: 'GitHub Cloud âڑ، Dokki' },
      notes: { stringValue: '' },
      dokki: { mapValue: { fields: {
        quota: { doubleValue: data.remaining },
        balance: { doubleValue: data.balance }
      }}},
      '104': { mapValue: { fields: {
        quota: { nullValue: null },
        balance: { nullValue: null }
      }}},
      gezira: { mapValue: { fields: {
        quota: { nullValue: null },
        balance: { nullValue: null }
      }}}
    };

    await tryMethods([
      async () => {
        const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/quota_history?key=${FIREBASE_API_KEY}`;
        const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fields: historyFields }) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        console.log('    POST to quota_history');
      },
      async () => {
        await sleep(2000);
        const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/quota_history?key=${FIREBASE_API_KEY}`;
        const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fields: historyFields }) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        console.log('    retry POST to quota_history');
      }
    ], 'LEDGER', 20000);

    console.log('  âœ“ Ledger updated!\n');

    // â•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گ
    console.log('STEP 8.5: LOW QUOTA FLAG');
    // â•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گ
    // Write flag to Firestore quota_settings/alerts
    // dokki_low: true  â†’ hourly workflow will run full harvest
    // dokki_low: false â†’ hourly workflow will skip (normal 2h schedule handles it)
    try {
      const isLowDokki = data.remaining < 100;
      const alertFields = {
        dokki_low:       { booleanValue: isLowDokki },
        dokki_quota:     { doubleValue: data.remaining },
        dokki_updatedAt: { stringValue: now }
      };
      const alertMask = 'updateMask.fieldPaths=dokki_low&updateMask.fieldPaths=dokki_quota&updateMask.fieldPaths=dokki_updatedAt';
      const alertUrl = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/quota_settings/alerts?key=${FIREBASE_API_KEY}&${alertMask}`;
      const alertRes = await fetch(alertUrl, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: alertFields })
      });
      if (alertRes.ok) {
        console.log('  âœ“ Low quota flag set: dokki_low=' + isLowDokki + ' (' + data.remaining.toFixed(1) + ' GB)\n');
      } else {
        console.log('  âڑ  Flag write failed (non-critical): HTTP ' + alertRes.status);
      }
    } catch(e) {
      console.log('  âڑ  Flag write error (non-critical):', e.message);
    }

    // â•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گ
    console.log('STEP 9: TELEGRAM');
    // â•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گ
    try {
      const date = new Date().toLocaleString('en-GB', {
        timeZone: 'Africa/Cairo',
        day: '2-digit', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit'
      });

      // Quota alert level
      const rem = data.remaining;
      let alertLine = '';
      if (rem < 30)       alertLine = '\nًںڑ¨ *CRITICAL â€” Under 30 GB! Recharge immediately!*';
      else if (rem < 50)  alertLine = '\nًں”´ *CRITICAL â€” Under 50 GB!*';
      else if (rem < 100) alertLine = '\nًںں  *WARNING â€” Under 100 GB*';

      // Status icon based on level
      const statusIcon = rem < 50 ? 'ًں”´' : rem < 100 ? 'ًںں ' : 'âœ…';

      const msg = [
        'ًں“، *Cairo Taj â€” Dokki Harvest*',
        '',
        `${statusIcon} Quota Remaining: *${rem.toFixed(2)} GB*`,
        `ًں“‰ Used: *${data.used.toFixed(2)} GB*`,
        `ًں’° Balance: *${data.balance.toFixed(2)} EGP*`,
        `ًں“‹ Plan: ${data.plan}`,
        `ًں•گ ${date}`,
        `ًں¤– GitHub Cloud âڑ، Dokki` + alertLine
      ].join('\n');

      const tgUrl = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;

      // Send main harvest message to personal chat AND group (if configured)
      const recipients = [TELEGRAM_CHAT_ID];
      if (TELEGRAM_GROUP_ID) recipients.push(TELEGRAM_GROUP_ID);

      let tgSuccess = false;
      for (const chatId of recipients) {
        if (!chatId) continue;
        const tgRes = await fetch(tgUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: chatId, text: msg, parse_mode: 'Markdown' })
        });
        if (tgRes.ok) { tgSuccess = true; }
        else { console.log('  âڑ  Telegram to ' + chatId + ': HTTP ' + tgRes.status); }
      }
      if (!tgSuccess) throw new Error('All Telegram sends failed');
      console.log('  âœ“ Telegram sent!\n');

      // CRITICAL ALERT: Under 30 GB â€” send a separate urgent message
      if (rem < 30) {
        const criticalMsg = {
          text: ['ًںڑ¨ًںڑ¨ًںڑ¨ *CRITICAL QUOTA ALERT* ًںڑ¨ًںڑ¨ًںڑ¨', '', 'âڑ ï¸ڈ *Cairo Taj â€” Dokki*',
            `ًں“‰ Only *${rem.toFixed(2)} GB* remaining!`, 'ًں”´ *ACTION REQUIRED: Recharge immediately!*', '', `ًں•گ ${date}`].join('\n'),
          parse_mode: 'Markdown',
          disable_notification: false
        };
        for (const chatId of recipients) {
          if (!chatId) continue;
          await fetch(tgUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...criticalMsg, chat_id: chatId }) });
        }
        console.log('  ًںڑ¨ Critical alert sent!\n');
      }

    } catch (e) {
      // Telegram failure should NOT fail the whole harvest
      console.log('  âڑ  Telegram failed (non-critical):', e.message);
    }
    console.log('â”پâ”پâ”پâ”پâ”پâ”پâ”پâ”پâ”پâ”پâ”پâ”پâ”پâ”پâ”پâ”پâ”پâ”پâ”پâ”پâ”پâ”پâ”پâ”پâ”پâ”پâ”پâ”پâ”پâ”پâ”پâ”پâ”پâ”پâ”پâ”پâ”پâ”پâ”پâ”پ');
    console.log('âœ… âœ… âœ…  SUCCESS  âœ… âœ… âœ…');
    console.log('â”پâ”پâ”پâ”پâ”پâ”پâ”پâ”پâ”پâ”پâ”پâ”پâ”پâ”پâ”پâ”پâ”پâ”پâ”پâ”پâ”پâ”پâ”پâ”پâ”پâ”پâ”پâ”پâ”پâ”پâ”پâ”پâ”پâ”پâ”پâ”پâ”پâ”پâ”پâ”پ');

    // â•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گ
    // VIGILANCE MODE â€” triggered when quota â‰¤ 50 GB (Dokki)
    // Stays in same session, refreshes every 13 minutes, harvests
    // until quota â‰¤ 2 GB or session dies (then restarts + re-switches line).
    // Only sends Telegram for Dokki â€” other line unaffected.
    // â•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گ
    if (data.remaining <= 50) {
      console.log('\nًں”´ VIGILANCE MODE ACTIVATED (DOKKI) â€” quota=' + data.remaining.toFixed(2) + ' GB â‰¤ 50 GB');
      console.log('  Will harvest every 13 min until quota â‰¤ 2 GB or job time limit reached.\n');

      const VIGILANCE_INTERVAL_MS = 13 * 60 * 1000;
      const VIGILANCE_MAX_MS      = 5 * 60 * 60 * 1000 + 45 * 60 * 1000;
      const VIGILANCE_STOP_GB     = 2;
      const vigilanceStart        = Date.now();
      let   vigilanceRound        = 0;
      let   lastRemaining         = data.remaining;

      // â”€â”€ Helper: refresh to account overview and re-switch to line 094 â”€â”€
      async function vigilanceRefreshPage() {
        await page.goto('https://my.te.eg/echannel/#/accountoverview', { waitUntil: 'networkidle2', timeout: 30000 });
        await sleep(3000);
        if (page.url().includes('#/login')) throw new Error('SESSION_DIED: redirected to login');
        // Re-switch to line 094 (same logic as Step 5.5)
        await page.waitForFunction(() => {
          const t = document.body.innerText;
          return t.includes('currently managing') || t.includes('Remaining');
        }, { timeout: 15000 }).catch(() => {});
        await sleep(1500);
        const dropdowns = await page.$$('.ant-select-selector, .ant-select');
        if (dropdowns.length) {
          await dropdowns[0].click();
          await sleep(1500);
          await page.evaluate(() => {
            const opts = Array.from(document.querySelectorAll('.ant-select-item-option-content, .ant-select-item, li, option'));
            const t = opts.find(o => o.textContent && o.textContent.includes('0237600094'));
            if (t) t.click();
          });
        }
        // Wait for full 094 data (same 6-condition gate)
        for (let w = 0; w < 30; w++) {
          await sleep(1000);
          if (page.url().includes('#/login') && w > 5) throw new Error('SESSION_DIED: redirected to login after line switch');
          const check = await checkPage094();
          if (check.hasRemaining && check.has094) {
            const captured = await extractNow();
            if (captured) {
              const totalGB = (captured.remaining || 0) + (captured.used || 0);
              if (captured.balance > 3000 && captured.balance > 0 && captured.plan !== 'Unknown' && totalGB > 300) {
                console.log('  âœ“ [VIGILANCE] Line 094 confirmed: rem=' + captured.remaining + ' bal=' + captured.balance);
                return captured;
              }
            }
          }
        }
        throw new Error('Line 094 data not confirmed after 30s');
      }

      // â”€â”€ Helper: write to Firestore (Dokki only) â”€â”€
      async function vigilanceFirestore(vData) {
        const vNow = new Date().toISOString();
        const vFields = {
          'dokki': { mapValue: { fields: {
            quota:     { doubleValue: vData.remaining },
            maxQuota:  { doubleValue: vData.remaining + vData.used },
            balance:   { doubleValue: vData.balance },
            used:      { doubleValue: vData.used },
            plan:      { stringValue: vData.plan },
            updatedAt: { stringValue: vNow },
            updatedBy: { stringValue: 'GitHub Cloud âڑ، Dokki [VIGILANCE]' },
            status:    { stringValue: 'success' }
          }}},
          lastUpdate: { stringValue: vNow }
        };
        const mask = 'updateMask.fieldPaths=dokki&updateMask.fieldPaths=lastUpdate';
        const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/quota_latest/current?key=${FIREBASE_API_KEY}&${mask}`;
        const res = await fetch(url, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fields: vFields }) });
        if (!res.ok) throw new Error('Firestore HTTP ' + res.status);
        const vHistory = {
          timestamp: { stringValue: vNow },
          user: { stringValue: 'GitHub Cloud âڑ، Dokki [VIGILANCE]' },
          notes: { stringValue: 'vigilance-mode' },
          dokki: { mapValue: { fields: { quota: { doubleValue: vData.remaining }, balance: { doubleValue: vData.balance } } } },
          '104': { mapValue: { fields: { quota: { nullValue: null }, balance: { nullValue: null } } } },
          gezira: { mapValue: { fields: { quota: { nullValue: null }, balance: { nullValue: null } } } }
        };
        const hUrl = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/quota_history?key=${FIREBASE_API_KEY}`;
        await fetch(hUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fields: vHistory }) });
      }

      // â”€â”€ Helper: send Vigilance Telegram (Dokki only) â”€â”€
      async function vigilanceTelegram(vData, vRound, elapsed) {
        try {
          const rem = vData.remaining;
          const elapsedMin = Math.floor(elapsed / 60000);
          const burned = lastRemaining - rem;
          const burnRate = burned > 0 ? (burned / (elapsedMin / 60)).toFixed(2) : '0.00';
          const hoursLeft = parseFloat(burnRate) > 0 ? (rem / parseFloat(burnRate)).toFixed(1) : 'âˆ‍';
          const date = new Date().toLocaleString('en-GB', {
            timeZone: 'Africa/Cairo', day: '2-digit', month: 'short',
            year: 'numeric', hour: '2-digit', minute: '2-digit'
          });
          const icon = rem <= 2 ? 'ًںڑ¨' : rem <= 10 ? 'ًں”´' : rem <= 20 ? 'ًںں ' : 'ًںں،';
          const urgency = rem <= 2  ? 'ًںڑ¨ *STOP â€” 2 GB REACHED! Recharge NOW!*' :
                          rem <= 5  ? 'ًں”´ *CRITICAL â€” Under 5 GB!*' :
                          rem <= 10 ? 'ًں”´ *CRITICAL â€” Under 10 GB! Recharge soon!*' :
                          rem <= 20 ? 'ًںں  *WARNING â€” Under 20 GB*' :
                          rem <= 30 ? 'ًںں، *NOTICE â€” Under 30 GB*' : '';
          const msg = [
            'âڑ، *Cairo Taj â€” Dokki [VIGILANCE MODE]*',
            '',
            icon + ' Quota: *' + rem.toFixed(2) + ' GB* remaining',
            'ًں“‰ Used: *' + vData.used.toFixed(2) + ' GB*',
            'ًں’° Balance: *' + vData.balance.toFixed(2) + ' EGP*',
            'ًں”¥ Burn rate: ~' + burnRate + ' GB/h',
            'âڈ± Est. time left: ~' + hoursLeft + 'h',
            'ًں”„ Vigilance round: #' + vRound + ' (' + elapsedMin + 'min in)',
            'ًں•گ ' + date,
            urgency
          ].filter(Boolean).join('\n');
          const tgUrl = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
          const recipients = [TELEGRAM_CHAT_ID];
          if (TELEGRAM_GROUP_ID) recipients.push(TELEGRAM_GROUP_ID);
          for (const chatId of recipients) {
            if (!chatId) continue;
            await fetch(tgUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ chat_id: chatId, text: msg, parse_mode: 'Markdown' }) });
          }
          if (rem <= 10) {
            const critMsg = {
              text: ['ًںڑ¨ًںڑ¨ًںڑ¨ *VIGILANCE CRITICAL* ًںڑ¨ًںڑ¨ًںڑ¨', '', 'âڑ ï¸ڈ *Cairo Taj â€” Dokki*',
                'ًں“‰ Only *' + rem.toFixed(2) + ' GB* remaining!',
                'ًں”´ *ACTION REQUIRED: Recharge immediately!*', '', 'ًں•گ ' + date].join('\n'),
              parse_mode: 'Markdown', disable_notification: false
            };
            for (const chatId of recipients) {
              if (!chatId) continue;
              await fetch(tgUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ...critMsg, chat_id: chatId }) });
            }
          }
          console.log('  âœ“ Vigilance Telegram sent (round #' + vRound + ')');
        } catch(e) { console.log('  âڑ  Vigilance Telegram failed (non-critical):', e.message); }
      }

      // â”€â”€ Helper: full re-login + re-switch to 094 when session dies â”€â”€
      async function vigilanceRestartSession() {
        console.log('  [VIGILANCE] Session died â€” restarting fresh session...');
        try { await browser.close(); } catch(e) {}
        browser = await puppeteer.launch({
          headless: true, executablePath: '/usr/bin/google-chrome-stable',
          protocolTimeout: 60000,
          args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage',
                 '--disable-blink-features=AutomationControlled',
                 '--disable-features=IsolateOrigins,site-per-process','--window-size=1366,768'],
          ignoreDefaultArgs: ['--enable-automation']
        });
        page = await browser.newPage();
        await page.evaluateOnNewDocument(() => {
          window.alert = () => {}; window.confirm = () => true; window.prompt = () => '';
          Object.defineProperty(window, 'console', { writable: false, configurable: false });
          Object.defineProperty(navigator, 'webdriver', { get: () => false });
          window.navigator.chrome = { runtime: {} };
          Object.defineProperty(navigator, 'plugins', { get: () => [1,2,3,4,5] });
          Object.defineProperty(navigator, 'languages', { get: () => ['en-US','en'] });
        });
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        await page.setViewport({ width: 1366, height: 768 });
        page.on('dialog', async dialog => { await dialog.accept(); });
        // Try saved cookies first
        const sc = await loadSavedCookies();
        if (sc && sc.length > 0) {
          await page.setCookie(...sc);
          await page.goto('https://my.te.eg/echannel/#/accountoverview', { waitUntil: 'networkidle2', timeout: 20000 });
          await sleep(3000);
          if (!page.url().includes('login')) {
            console.log('  [VIGILANCE] Session restored from cookies âœ“');
            return;
          }
          await clearCookies();
        }
        // Full fresh login
        await tryMethods([
          async () => {
            await page.goto('https://my.te.eg/echannel/', { waitUntil: 'networkidle2', timeout: 30000 });
            await page.waitForFunction(() => document.querySelectorAll('input').length >= 2, { timeout: 15000 });
          },
          async () => {
            await page.goto('https://my.te.eg/echannel/', { waitUntil: 'domcontentloaded', timeout: 40000 });
            await page.waitForFunction(() => document.querySelectorAll('input').length >= 2, { timeout: 20000 });
          }
        ], 'VIGILANCE RE-NAVIGATE', 55000);
        await sleep(randomDelay(3000, 5000));
        await page.focus('#login_loginid_input_01').catch(() => {});
        await sleep(2000);
        await page.type('#login_loginid_input_01', WE_USERNAME, { delay: randomDelay(100, 180) });
        await sleep(randomDelay(4000, 6000));
        // Dropdown — supports both new search-input style and old ant-select
        await page.waitForFunction(() => !!document.querySelector('#login_input_type_01, .ant-select-selector, .ant-select'), { timeout: 12000 }).catch(() => {});
        await sleep(500);
        const ddSearch = await page.$('#login_input_type_01');
        if (ddSearch) {
          await ddSearch.click(); await sleep(500);
          await ddSearch.type('Internet', { delay: 80 }); await sleep(800);
          const clicked = await page.evaluate(() => {
            const opts = Array.from(document.querySelectorAll('.ant-select-item-option, li, [class*="option"]'));
            const inet = opts.find(o => o.textContent?.toLowerCase().includes('internet'));
            if (inet) { inet.click(); return true; } return false;
          });
          if (!clicked) { await page.keyboard.press('ArrowDown'); await sleep(200); await page.keyboard.press('Enter'); }
        } else {
          const dd = await page.$('.ant-select-selector, .ant-select');
          if (dd) { await dd.click(); await sleep(1500); }
          await page.evaluate(() => {
            for (const el of document.querySelectorAll('.ant-select-item-option, li')) {
              if (el.textContent?.toLowerCase().includes('internet')) { el.click(); return; }
            }
          });
        }
        await sleep(randomDelay(4000, 6000));
        await page.focus('#login_password_input_01').catch(() => {});
        await sleep(2000);
        await page.type('#login_password_input_01', WE_PASSWORD, { delay: randomDelay(100, 180) });
        await sleep(randomDelay(4000, 6000));
        await page.evaluate(() => {
          const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.toLowerCase().includes('login') || b.className.includes('primary'));
          if (btn) btn.click();
        });
        for (let t = 0; t < 20; t++) {
          await sleep(1000);
          if (!page.url().includes('login')) break;
        }
        if (page.url().includes('login')) throw new Error('Re-login failed after session death');
        console.log('  [VIGILANCE] Fresh login successful âœ“');
        try {
          const nc = await page.cookies();
          const rel = nc.filter(c => c.domain.includes('te.eg') || c.domain.includes('telecomegypt'));
          if (rel.length > 0) await saveCookies(rel);
        } catch(e) {}
      }

      // â•گâ•گ MAIN VIGILANCE LOOP (Dokki) â•گâ•گ
      while (true) {
        const elapsed = Date.now() - vigilanceStart;
        if (elapsed >= VIGILANCE_MAX_MS) {
          console.log('\n[VIGILANCE] 5h 45m safety cap reached â€” stopping vigilance mode.');
          break;
        }
        console.log('\n[VIGILANCE] Waiting 13 minutes for next harvest...');
        await sleep(VIGILANCE_INTERVAL_MS);

        vigilanceRound++;
        const elapsedMin = Math.floor((Date.now() - vigilanceStart) / 60000);
        console.log('\n' + 'â•گ'.repeat(50));
        console.log('âڑ، VIGILANCE ROUND #' + vigilanceRound + ' â€” DOKKI (' + elapsedMin + 'min elapsed)');
        console.log('â•گ'.repeat(50));

        try {
          // Refresh page + re-switch to 094 (returns confirmed vData directly)
          const vData = await vigilanceRefreshPage();
          console.log('  Remaining: ' + vData.remaining + ' GB | Used: ' + vData.used + ' GB | Balance: ' + vData.balance + ' EGP');

          await vigilanceFirestore(vData);
          console.log('  âœ“ Firestore + Ledger updated');

          try {
            const vNow = new Date().toISOString();
            const isLowDokki = vData.remaining < 100;
            const alertFields = {
              dokki_low: { booleanValue: isLowDokki },
              dokki_quota: { doubleValue: vData.remaining },
              dokki_updatedAt: { stringValue: vNow }
            };
            const alertMask = 'updateMask.fieldPaths=dokki_low&updateMask.fieldPaths=dokki_quota&updateMask.fieldPaths=dokki_updatedAt';
            const alertUrl = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/quota_settings/alerts?key=${FIREBASE_API_KEY}&${alertMask}`;
            await fetch(alertUrl, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fields: alertFields }) });
          } catch(e) { console.log('  âڑ  Flag update failed (non-critical):', e.message); }

          await vigilanceTelegram(vData, vigilanceRound, Date.now() - vigilanceStart);
          lastRemaining = vData.remaining;

          if (vData.remaining <= VIGILANCE_STOP_GB) {
            console.log('\nًںڑ¨ [VIGILANCE] Quota reached ' + vData.remaining.toFixed(2) + ' GB â€” STOP THRESHOLD HIT.');
            console.log('  Vigilance mode complete. Awaiting manual recharge.');
            break;
          }

        } catch (vErr) {
          console.log('  [VIGILANCE] Round #' + vigilanceRound + ' error: ' + vErr.message);
          if (vErr.message.includes('SESSION_DIED') || vErr.message.includes('redirected to login') || vErr.message.includes('ALL METHODS FAILED')) {
            console.log('  [VIGILANCE] Session dead â€” attempting restart...');
            try {
              await vigilanceRestartSession();
              console.log('  [VIGILANCE] Session restarted. Will retry on next round.');
            } catch (restartErr) {
              console.log('  [VIGILANCE] Restart failed: ' + restartErr.message + ' â€” stopping vigilance.');
              break;
            }
          } else {
            console.log('  [VIGILANCE] Non-fatal error, continuing...');
          }
        }
      }

      console.log('\n[VIGILANCE] Exiting vigilance mode after ' + vigilanceRound + ' rounds (Dokki).');
    } // end vigilance mode

  } catch (error) {
    console.error('\nâ‌Œ ERROR:', error.message);
    if (page) {
      try {
        const ss = await withTimeout(page.screenshot({ encoding: 'base64' }), 5000, 'screenshot');
        console.log('Screenshot length:', ss.length);
        const state = await withTimeout(page.evaluate(() => ({
          url: window.location.href,
          inputs: Array.from(document.querySelectorAll('input')).map(i => ({ id: i.id, type: i.type, visible: i.offsetParent !== null })),
          bodyLen: document.body.innerHTML.length
        })), 5000, 'state');
        console.log('Page state:', JSON.stringify(state));
      } catch (e) { console.log('Diagnostics failed:', e.message); }
    }
    throw error;
  } finally {
    if (browser) await browser.close();
  }
}

async function main() {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      console.log(`\n${'â•گ'.repeat(50)}\nATTEMPT ${attempt}/${MAX_RETRIES}\n${'â•گ'.repeat(50)}\n`);
      await harvestQuota();
      console.log('\nًںژ‰ COMPLETE!');
      process.exit(0);
    } catch (error) {
      console.error(`\nAttempt ${attempt} failed: ${error.message}`);
      if (error.message && error.message.includes('WE_BLOCKED')) {
        console.error('â›” WE block detected â€” stopping all retries to avoid extending the block');
        console.error('ًں’€ Will retry on next scheduled run automatically');
        process.exit(1);
      }
      if (attempt < MAX_RETRIES) {
        const d = randomDelay(30000, 45000);
        console.log(`Retrying in ${Math.floor(d/1000)}s...`);
        await sleep(d);
      } else {
        console.error('\nًں’€ ALL ATTEMPTS FAILED');
        process.exit(1);
      }
    }
  }
}

main();

