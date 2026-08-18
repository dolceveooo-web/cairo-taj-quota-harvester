const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fetch = require('node-fetch');

puppeteer.use(StealthPlugin());

const FIREBASE_API_KEY = process.env.FIREBASE_API_KEY;
const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID;
const WE_USERNAME = process.env.WE_USERNAME;
const WE_PASSWORD = process.env.WE_PASSWORD;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const TELEGRAM_GROUP_ID = process.env.TELEGRAM_GROUP_ID;
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
      console.log(`  ✓ Method ${i+1} SUCCESS`);
      return result;
    } catch (e) {
      console.log(`  ✗ Method ${i+1} FAILED: ${e.message}`);
      if (i === methods.length - 1) throw new Error(`${stepName} ALL METHODS FAILED`);
      await sleep(500);
    }
  }
}

async function harvestQuota() {
  console.log('🚀 STARTING...\n');
  let browser, page;

  async function loadSavedCookies() {
    try {
      const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/quota_settings/session_104?key=${FIREBASE_API_KEY}`;
      const res = await fetch(url);
      if (!res.ok) return null;
      const doc = await res.json();
      const cookieStr = doc?.fields?.cookies?.stringValue;
      const savedAt = doc?.fields?.savedAt?.stringValue;
      if (!cookieStr || !savedAt) return null;
      const age = Date.now() - new Date(savedAt).getTime();
      if (age > 4 * 60 * 60 * 1000) { console.log('  [SESSION] Cookies expired (>4h old), will do fresh login'); return null; }
      console.log('  [SESSION] Found saved cookies (' + Math.floor(age/60000) + 'm old)');
      return JSON.parse(cookieStr);
    } catch(e) { console.log('  [SESSION] Could not load cookies:', e.message); return null; }
  }

  async function saveCookies(cookies) {
    try {
      const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/quota_settings/session_104?key=${FIREBASE_API_KEY}`;
      await fetch(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: {
          cookies:  { stringValue: JSON.stringify(cookies) },
          savedAt:  { stringValue: new Date().toISOString() },
          line:     { stringValue: '104' }
        }})
      });
      console.log('  [SESSION] Cookies saved to Firestore ✓');
    } catch(e) { console.log('  [SESSION] Could not save cookies:', e.message); }
  }

  async function clearCookies() {
    try {
      const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/quota_settings/session_104?key=${FIREBASE_API_KEY}`;
      await fetch(url, { method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: { cookies: { stringValue: '' }, savedAt: { stringValue: '' } }})
      });
      console.log('  [SESSION] Cookies cleared from Firestore');
    } catch(e) {}
  }

  try {
    // Detect Chrome path: GitHub Actions uses chromium, local uses chrome-stable
    const chromePaths = [
      '/opt/hostedtoolcache/setup-chrome/chromium/stable/x64/chrome',
      '/usr/bin/google-chrome-stable',
      '/usr/bin/chromium-browser',
      '/usr/bin/chromium'
    ];
    const { execSync } = require('child_process');
    let executablePath = chromePaths[0];
    for (const p of chromePaths) {
      try { execSync(`test -f ${p}`, { stdio: 'ignore' }); executablePath = p; break; } catch(e) {}
    }
    console.log('  [BROWSER] Using:', executablePath);

    browser = await puppeteer.launch({
      headless: true,
      executablePath,
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
      window.alert = () => {};
      window.confirm = () => true;
      window.prompt = () => '';
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

    // ══════════════════════════════════════
    console.log('STEP 0: SESSION CHECK');
    // ══════════════════════════════════════
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
          console.log('  ✓ Session still valid! Skipping login entirely.\n');
        } else {
          console.log('  ✗ Session expired, clearing and doing fresh login');
          await clearCookies();
        }
      } catch(e) {
        console.log('  ✗ Session check failed:', e.message);
        await clearCookies();
      }
    } else {
      console.log('  No saved session, will do fresh login\n');
    }

    // ══════════════════════════════════════
    console.log('STEP 1: NAVIGATE');
    // ══════════════════════════════════════
    if (!sessionValid) {
      await tryMethods([
        async () => {
          await page.goto('https://my.te.eg/echannel/', { waitUntil: 'networkidle2', timeout: 30000 });
          await page.waitForFunction(() => document.querySelectorAll('input').length >= 2, { timeout: 15000 });
          console.log('    networkidle2 + wait for 2 inputs (local harvester method)');
        },
        async () => {
          await page.goto('https://my.te.eg/echannel/', { waitUntil: 'domcontentloaded', timeout: 40000 });
          await page.waitForFunction(() => document.querySelectorAll('input').length >= 2, { timeout: 20000 });
          console.log('    domcontentloaded + wait for 2 inputs');
        },
        async () => {
          await page.goto('https://my.te.eg/echannel/', { waitUntil: 'load', timeout: 40000 });
          await page.waitForFunction(() => document.querySelectorAll('input').length >= 2, { timeout: 20000 });
          console.log('    load + wait for 2 inputs');
        },
        async () => {
          await page.goto('https://my.te.eg/echannel/', { timeout: 40000 });
          await sleep(15000);
          const count = await page.evaluate(() => document.querySelectorAll('input').length);
          if (count < 1) throw new Error(`Only ${count} inputs found`);
          console.log(`    no wait + 15s sleep, found ${count} inputs`);
        },
        async () => {
          await page.goto('https://my.te.eg/echannel/', { waitUntil: 'domcontentloaded', timeout: 40000 });
          await sleep(20000);
          console.log('    domcontentloaded + 20s sleep');
        }
      ], 'NAVIGATE', 55000);

      console.log('  URL:', page.url());

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

      const delay1 = randomDelay(5000, 8000);
      console.log('  [HUMAN] pause', delay1, 'ms');
      await sleep(delay1);

      // ══════════════════════════════════════
      console.log('STEP 2: SERVICE NUMBER (USERNAME)');
      // ══════════════════════════════════════
      await tryMethods([
        async () => {
          await page.focus('#login_loginid_input_01');
          await sleep(3000);
          await page.type('#login_loginid_input_01', WE_USERNAME, { delay: randomDelay(100, 200) });
          await sleep(3000);
          console.log('    focus + type (local harvester method)');
        },
        async () => {
          const el = await page.$('#login_loginid_input_01');
          if (!el) throw new Error('ID not found');
          await el.click(); await sleep(3000);
          await el.type(WE_USERNAME, { delay: randomDelay(100, 200) });
          await sleep(3000);
          console.log('    $ find + click + type');
        },
        async () => {
          const els = await page.$$('.ant-input');
          if (!els.length) throw new Error('no .ant-input');
          await els[0].click(); await sleep(3000);
          await els[0].type(WE_USERNAME, { delay: randomDelay(100, 200) });
          await sleep(3000);
          console.log('    .ant-input class');
        },
        async () => {
          const els = await page.$$('input[type="text"]');
          if (!els.length) throw new Error('no text inputs');
          await els[0].click(); await sleep(3000);
          await els[0].type(WE_USERNAME, { delay: randomDelay(100, 200) });
          await sleep(3000);
          console.log('    input[type=text]');
        },
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
        async () => {
          const all = await page.$$('input');
          if (!all.length) throw new Error('no inputs at all');
          for (let i = 0; i < all.length; i++) {
            const info = await all[i].evaluate(el => ({ type: el.type, visible: el.offsetParent !== null, id: el.id }));
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
        async () => {
          await page.focus('body');
          await sleep(3000);
          await page.keyboard.press('Tab');
          await sleep(1000);
          await page.keyboard.type(WE_USERNAME, { delay: randomDelay(100, 200) });
          await sleep(3000);
          console.log('    Tab from body + type');
        },
        async () => {
          await page.click('input');
          await sleep(3000);
          await page.keyboard.type(WE_USERNAME, { delay: randomDelay(100, 200) });
          await sleep(3000);
          console.log('    click first input + keyboard');
        }
      ], 'SERVICE NUMBER', 60000);

      console.log('  [OK] Service number entered\n');

      const delay2 = randomDelay(5000, 8000);
      console.log('  [HUMAN] pause', delay2, 'ms');
      await sleep(delay2);

      console.log('  Waiting for dropdown to appear...');
      await withTimeout(
        page.waitForFunction(() => !!document.querySelector('.ant-select, .ant-select-selector, [class*="select"]'), { timeout: 15000 }),
        16000, 'dropdown appearance'
      ).catch(() => console.log('  [WARN] Dropdown wait timed out, proceeding anyway'));
      await sleep(1000);

      const dropdownDiag = await withTimeout(page.evaluate(() => ({
        antSelect: !!document.querySelector('.ant-select'),
        antSelectSelector: !!document.querySelector('.ant-select-selector'),
        searchInput: !!document.querySelector('#login_input_type_01'),
        anySelect: !!document.querySelector('[class*="select"]'),
        selectText: document.querySelector('.ant-select-selector')?.innerText || document.querySelector('#login_input_type_01')?.value || null
      })), 5000, 'dropdown diag').catch(() => null);
      console.log('  Dropdown state:', JSON.stringify(dropdownDiag));

      // ══════════════════════════════════════
      console.log('STEP 3: DROPDOWN');
      // ══════════════════════════════════════
      await tryMethods([
        // M0: New search-input style
        async () => {
          const searchInput = await page.$('#login_input_type_01');
          if (!searchInput) throw new Error('search input not found');
          await searchInput.click(); await sleep(500);
          await searchInput.evaluate(el => { el.value=''; el.dispatchEvent(new Event('input',{bubbles:true})); });
          await searchInput.type('Internet', { delay: 80 }); await sleep(1000);
          const clicked = await page.evaluate(() => {
            const opts = Array.from(document.querySelectorAll('.ant-select-item-option, .ant-select-item, li, [class*="option"]'));
            const inet = opts.find(o => o.textContent?.toLowerCase().includes('internet'));
            if (inet) { inet.click(); return inet.textContent.trim(); }
            return null;
          });
          if (!clicked) { await page.keyboard.press('ArrowDown'); await sleep(300); await page.keyboard.press('Enter'); }
          else { console.log('    M0: search input + clicked:', clicked); }
          await sleep(800);
          const val = await page.evaluate(() => (document.querySelector('.ant-select-selector')?.innerText||'') + (document.querySelector('#login_input_type_01')?.value||''));
          if (!val.toLowerCase().includes('internet')) throw new Error('Internet not confirmed: ' + val);
        },
        async () => {
          await page.waitForFunction(() => !!document.querySelector('.ant-select-selector, .ant-select'), { timeout: 10000 });
          await sleep(500);
          const dropdown = await page.$('.ant-select-selector, .ant-select');
          if (!dropdown) throw new Error('dropdown not found after wait');
          await dropdown.click();
          await sleep(1500);
          const clicked = await page.evaluate(() => {
            const items = Array.from(document.querySelectorAll('.ant-select-item-option, .ant-select-item, li'));
            const internet = items.find(i => i.textContent.toLowerCase().includes('internet'));
            if (internet) { internet.click(); return internet.textContent.trim(); }
            return null;
          });
          if (!clicked) throw new Error('Internet option not found');
          console.log('    waitForFunction + click, selected:', clicked);
          await sleep(500);
        },
        async () => {
          await page.waitForSelector('.ant-select-selector', { timeout: 10000 });
          await sleep(500);
          await page.click('.ant-select-selector');
          await sleep(1500);
          await page.evaluate(() => {
            for (let el of document.querySelectorAll('.ant-select-item-option, li, div')) {
              if (el.textContent?.toLowerCase().includes('internet')) { el.click(); return; }
            }
          });
          console.log('    waitForSelector + click');
          await sleep(500);
        },
        async () => {
          await page.waitForSelector('.ant-select', { timeout: 10000 });
          await page.click('.ant-select');
          await sleep(1500);
          await page.keyboard.press('ArrowDown');
          await sleep(300);
          await page.keyboard.press('Enter');
          console.log('    click + arrow + enter');
        },
        async () => {
          await sleep(2000);
          await page.evaluate(() => { document.querySelector('.ant-select-selector')?.click(); });
          await sleep(2000);
          await page.evaluate(() => {
            for (let el of document.querySelectorAll('li, div, span')) {
              if (el.textContent?.toLowerCase().includes('internet')) { el.click(); return; }
            }
          });
          console.log('    evaluate click + broad search');
        }
      ], 'DROPDOWN', 20000);

      console.log('  [OK] Dropdown done\n');

      const delay3 = randomDelay(5000, 8000);
      console.log('  [HUMAN] pause', delay3, 'ms');
      await sleep(delay3);

      // ══════════════════════════════════════
      console.log('STEP 4: PASSWORD');
      // ══════════════════════════════════════
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

      const delay4 = randomDelay(5000, 8000);
      console.log('  [HUMAN] pause', delay4, 'ms');
      await sleep(delay4);

      // ══════════════════════════════════════
      console.log('STEP 5: SUBMIT');
      // ══════════════════════════════════════
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

      // POST-SUBMIT: Race - URL change vs captcha modal vs block
      console.log('  Waiting for login result...');
      let postLoginState = 'unknown';
      for (let tick = 0; tick < 30; tick++) {
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
                            text.includes('blocked') || text.includes('\u0645\u062d\u0627\u0648\u0644\u0627\u062a') ||
                            text.includes('\u0627\u0644\u062d\u062f \u0627\u0644\u0627\u0642\u0635\u0649') ||
                            text.includes('\u0645\u0631\u0647 \u0627\u062e\u0631\u0649');
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
        throw new Error('WE_BLOCKED: Account/IP temporarily blocked. Will auto-retry on next scheduled run (2h).');
      }

      if (postLoginState === 'unknown') {
        throw new Error('Still on login page - no navigation or captcha after 30s');
      }

      // CAPTCHA ENGINE
      if (postLoginState === 'captcha') {
        console.log('  [CAPTCHA] Ultimate Engine v4 starting...\n');

        async function findCaptchaImg() {
          return await page.evaluateHandle(() => {
            const modal = document.querySelector('.ant-modal-content, .ant-modal, [class*="modal"]');
            if (!modal) return null;
            const imgs = Array.from(modal.querySelectorAll('img'));
            imgs.sort((a, b) => {
              const aR = a.getBoundingClientRect(), bR = b.getBoundingClientRect();
              return (bR.width * bR.height) - (aR.width * aR.height);
            });
            for (const img of imgs) {
              const r = img.getBoundingClientRect();
              if (r.width > 80 && r.height > 25 && img.naturalWidth > 0) return img;
            }
            return null;
          });
        }

        async function canvasProcess(imgHandle, filter) {
          return await page.evaluate((imgEl, f) => {
            if (!imgEl || !imgEl.naturalWidth) return null;
            const scale = 3;
            const c = document.createElement('canvas');
            c.width = imgEl.naturalWidth * scale;
            c.height = imgEl.naturalHeight * scale;
            const ctx = c.getContext('2d');
            ctx.imageSmoothingEnabled = false;
            ctx.drawImage(imgEl, 0, 0, c.width, c.height);
            const data = ctx.getImageData(0, 0, c.width, c.height);
            const d = data.data;
            for (let i = 0; i < d.length; i += 4) {
              const r = d[i], g = d[i+1], b = d[i+2];
              let keep = false;
              if (f === 'red') {
                keep = r > 100 && (r - g) > 30 && (r - b) > 30;
              } else if (f === 'dark') {
                const lum = 0.299*r + 0.587*g + 0.114*b;
                keep = lum < 140;
              } else {
                const max = Math.max(r,g,b), min = Math.min(r,g,b);
                const sat = max === 0 ? 0 : (max - min) / max;
                keep = sat > 0.3 && r > g;
              }
              d[i] = d[i+1] = d[i+2] = keep ? 0 : 255;
            }
            ctx.putImageData(data, 0, 0);
            return c.toDataURL('image/png');
          }, imgHandle, filter);
        }

        async function ocrRead(imageData) {
          const Tesseract = require('tesseract.js');
          const results = [];
          const r1 = await Tesseract.recognize(imageData, 'eng', {
            tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789',
            tessedit_pageseg_mode: '8'
          });
          const t1 = r1.data.text.replace(/[^A-Za-z0-9]/g, '').trim();
          if (t1) results.push(t1);
          if (t1.length !== 5) {
            const r2 = await Tesseract.recognize(imageData, 'eng', {
              tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789',
              tessedit_pageseg_mode: '7'
            });
            const t2 = r2.data.text.replace(/[^A-Za-z0-9]/g, '').trim();
            if (t2 && t2 !== t1) results.push(t2);
          }
          return results;
        }

        async function submitAnswer(answer) {
          console.log('    -> Submitting:', answer);
          const ok = await page.evaluate((ans) => {
            const modal = document.querySelector('.ant-modal-content, .ant-modal, [class*="modal"]');
            if (!modal) return false;
            const inp = modal.querySelector('input.ant-input, input[type="text"]');
            if (!inp) return false;
            inp.focus();
            inp.click();
            const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
            setter.call(inp, '');
            inp.dispatchEvent(new Event('input', { bubbles: true }));
            setter.call(inp, ans);
            inp.dispatchEvent(new Event('input', { bubbles: true }));
            inp.dispatchEvent(new Event('change', { bubbles: true }));
            const allBtns = Array.from(modal.querySelectorAll('button'));
            const btn = allBtns.find(b => /ok|confirm|submit/i.test(b.textContent)) ||
                        modal.querySelector('button.ant-btn-primary') ||
                        allBtns[allBtns.length - 1];
            if (btn) btn.click();
            return true;
          }, answer);
          if (!ok) {
            console.log('    -> Keyboard fallback');
            await page.keyboard.press('Tab');
            await sleep(200);
            await page.keyboard.type(answer, { delay: 40 });
            await sleep(300);
            await page.keyboard.press('Enter');
          }
          await sleep(5000);
          return !page.url().includes('login');
        }

        async function isModalOpen() {
          return await page.evaluate(() => {
            const modal = document.querySelector('.ant-modal-content, .ant-modal, [class*="modal"]');
            return !!modal;
          });
        }

        const FILTERS = ['red', 'dark', 'contrast'];
        let captchaSolved = false;

        for (let round = 1; round <= 6 && !captchaSolved; round++) {
          console.log('  -- Round', round, '/ 6 --');
          if (round > 1) {
            let modalFound = false;
            for (let w = 0; w < 10; w++) {
              await sleep(1000);
              const isOpen = await isModalOpen();
              if (isOpen) { modalFound = true; break; }
              if (!page.url().includes('login')) { captchaSolved = true; console.log('  [OK] Navigated away - login succeeded!'); break; }
            }
            if (captchaSolved) break;
            if (!modalFound) {
              console.log('    Modal not found, re-clicking Login...');
              await page.evaluate(() => {
                const btns = Array.from(document.querySelectorAll('button'));
                const btn = btns.find(b => b.textContent.toLowerCase().includes('login') || b.className.includes('primary'));
                if (btn) btn.click();
              });
              await sleep(3000);
              const nowOpen = await isModalOpen();
              if (!nowOpen) {
                if (!page.url().includes('login')) { captchaSolved = true; break; }
                console.log('    ! Still no modal, skipping round');
                continue;
              }
            }
            await sleep(1000);
          }
          try {
            let imgHandle = null;
            for (let retry = 0; retry < 8; retry++) {
              imgHandle = await findCaptchaImg();
              const isValid = await page.evaluate(el => el && el.naturalWidth > 0, imgHandle).catch(() => false);
              if (isValid) break;
              imgHandle = null;
              await sleep(1000);
            }
            if (!imgHandle) { console.log('    ! No valid captcha image after 8s'); continue; }
            let bestAnswer = '';
            for (const filter of FILTERS) {
              const b64 = await canvasProcess(imgHandle, filter);
              if (!b64) continue;
              const texts = await ocrRead(b64);
              const match = texts.find(t => t.length === 5);
              console.log('    [' + filter + '] OCR:', JSON.stringify(texts), match ? '[OK]' : '[SKIP]');
              if (match) { bestAnswer = match; break; }
            }
            if (!bestAnswer) { console.log('    ! No 5-char result from any filter'); continue; }
            const variantIndex = (round - 1) % 3;
            const attempt = variantIndex === 1 ? bestAnswer.toUpperCase() : variantIndex === 2 ? bestAnswer.toLowerCase() : bestAnswer;
            console.log('    -> Trying [' + ['orig','UPPER','lower'][variantIndex] + ']:', attempt);
            captchaSolved = await submitAnswer(attempt);
            if (captchaSolved) { console.log('  >>> CAPTCHA SOLVED on round', round, '! <<<'); }
            else { console.log('    X Wrong answer "' + attempt + '", next round...'); }
          } catch (e) { console.log('    ! Error:', e.message); }
        }

        if (!captchaSolved) {
          await page.evaluate(() => {
            const modal = document.querySelector('.ant-modal-content, .ant-modal, [class*="modal"]');
            const btn = modal?.querySelector('button');
            if (btn) btn.click();
          });
          await sleep(2000);
          throw new Error('Captcha unsolvable after 12 rounds - retrying login');
        }
      }

      console.log('STEP 2: SERVICE NUMBER (USERNAME)');
      console.log('  ✓ Login successful!\n');

      try {
        const cookies = await page.cookies();
        const relevantCookies = cookies.filter(c => c.domain.includes('te.eg') || c.domain.includes('telecomegypt'));
        if (relevantCookies.length > 0) { await saveCookies(relevantCookies); }
      } catch(e) { console.log('  [SESSION] Could not save cookies:', e.message); }

    } // end if (!sessionValid)

    // ══════════════════════════════════════
    console.log('STEP 6: EXTRACT');
    // ══════════════════════════════════════
    const data = await tryMethods([
      async () => {
        await sleep(2000);
        await withTimeout(
          page.waitForFunction(() => {
            const text = document.body.innerText;
            return text.includes('Current Balance') && /[\d,]+\.?\d+\s*EGP/.test(text);
          }, { timeout: 8000 }),
          9000, 'balance card wait'
        ).catch(() => console.log('    [WARN] Balance card slow, proceeding anyway'));
        const result = await page.evaluate(() => {
          const spans = Array.from(document.querySelectorAll('span, div, p'));
          let remaining = null, used = null, balance = null, plan = null;
          function isNumericText(t) {
            if (!t) return false;
            const stripped = t.replace(/,/g, '').trim();
            return /^\d+(\.\d+)?$/.test(stripped) && !stripped.startsWith('0237') && !stripped.startsWith('023');
          }
          for (let i = 0; i < spans.length; i++) {
            const t = spans[i].innerText?.trim();
            if (!t || t.length > 100) continue;
            if (t === 'Remaining') { for (let back = 1; back <= 3; back++) { if (i - back >= 0) { const candidate = spans[i - back].innerText?.trim(); if (isNumericText(candidate)) { remaining = candidate; break; } } } }
            if (t === 'Used') { for (let back = 1; back <= 3; back++) { if (i - back >= 0) { const candidate = spans[i - back].innerText?.trim(); if (isNumericText(candidate)) { used = candidate; break; } } } }
            if (t === 'Current Balance') { for (let fwd = 1; fwd <= 8; fwd++) { if (i + fwd < spans.length) { const candidate = spans[i + fwd].innerText?.trim(); if (isNumericText(candidate)) { balance = candidate; break; } } } }
            if (t.includes('GB') && t.toLowerCase().includes('speed')) plan = t;
          }
          if (!balance) {
            const text = document.body.innerText;
            const bMatch = text.match(/Current Balance\s*[\n\r\s]*([\d,]+\.?\d+)/i) || text.match(/([\d,]+\.?\d+)\s*EGP/i);
            if (bMatch) balance = bMatch[1];
          }
          if (!remaining) throw new Error('no remaining found');
          return { remaining, used: used||'0', balance: balance||'0', plan: plan||'Unknown' };
        });
        const parsed = { remaining: stripNum(result.remaining), used: stripNum(result.used)||0, balance: stripNum(result.balance)||0, plan: result.plan };
        if (!parsed.remaining && parsed.remaining !== 0) throw new Error('no data after stripNum');
        console.log('    M1 numeric-only sibling scan');
        return parsed;
      },
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
        console.log('    M2 page text regex number-before-label');
        return parsed;
      },
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

    // ══════════════════════════════════════
    console.log('STEP 7: FIRESTORE');
    // ══════════════════════════════════════
    const now = new Date().toISOString();
    const fields = {
      '104': { mapValue: { fields: {
        quota:    { doubleValue: data.remaining },
        maxQuota: { doubleValue: data.remaining + data.used },
        balance:  { doubleValue: data.balance },
        used:     { doubleValue: data.used },
        plan:     { stringValue: data.plan },
        updatedAt: { stringValue: now },
        updatedBy: { stringValue: 'GitHub Cloud' },
        status:   { stringValue: 'success' }
      }}},
      lastUpdate: { stringValue: now }
    };
    await tryMethods([
      async () => {
        const mask = 'updateMask.fieldPaths=%60104%60&updateMask.fieldPaths=lastUpdate';
        const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/quota_latest/current?key=${FIREBASE_API_KEY}&${mask}`;
        const res = await fetch(url, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fields }) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        console.log('    updateMask PATCH');
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
    console.log('  ✓ Uploaded to quota_latest!\n');

    // ══════════════════════════════════════
    console.log('STEP 8: LEDGER (quota_history)');
    // ══════════════════════════════════════
    const historyFields = {
      timestamp: { stringValue: now },
      user: { stringValue: 'GitHub Cloud' },
      notes: { stringValue: '' },
      dokki: { mapValue: { fields: { quota: { nullValue: null }, balance: { nullValue: null } } } },
      '104': { mapValue: { fields: { quota: { doubleValue: data.remaining }, balance: { doubleValue: data.balance } } } },
      gezira: { mapValue: { fields: { quota: { nullValue: null }, balance: { nullValue: null } } } }
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
    console.log('  ✓ Ledger updated!\n');

    // ══════════════════════════════════════
    console.log('STEP 8.5: LOW QUOTA FLAG');
    // ══════════════════════════════════════
    try {
      const isLow104 = data.remaining < 100;
      const alertFields = {
        line104_low:       { booleanValue: isLow104 },
        line104_quota:     { doubleValue: data.remaining },
        line104_updatedAt: { stringValue: now }
      };
      const alertMask = 'updateMask.fieldPaths=line104_low&updateMask.fieldPaths=line104_quota&updateMask.fieldPaths=line104_updatedAt';
      const alertUrl = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/quota_settings/alerts?key=${FIREBASE_API_KEY}&${alertMask}`;
      const alertRes = await fetch(alertUrl, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fields: alertFields }) });
      if (alertRes.ok) { console.log('  ✓ Low quota flag set: line104_low=' + isLow104 + ' (' + data.remaining.toFixed(1) + ' GB)\n'); }
      else { console.log('  ⚠ Flag write failed (non-critical): HTTP ' + alertRes.status); }
    } catch(e) { console.log('  ⚠ Flag write error (non-critical):', e.message); }

    // ══════════════════════════════════════
    console.log('STEP 9: TELEGRAM');
    // ══════════════════════════════════════
    try {
      const date = new Date().toLocaleString('en-GB', { timeZone: 'Africa/Cairo', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
      const rem = data.remaining;
      let alertLine = '';
      if (rem < 30)       alertLine = '\n🚨 *CRITICAL - Under 30 GB! Recharge immediately!*';
      else if (rem < 50)  alertLine = '\n🔴 *CRITICAL - Under 50 GB!*';
      else if (rem < 100) alertLine = '\n🟠 *WARNING - Under 100 GB*';
      const statusIcon = rem < 50 ? '🔴' : rem < 100 ? '🟠' : '✅';
      const msg = [
        '📡 *Cairo Taj - Line 104 Harvest*', '',
        statusIcon + ' Quota Remaining: *' + rem.toFixed(2) + ' GB*',
        '📉 Used: *' + data.used.toFixed(2) + ' GB*',
        '💰 Balance: *' + data.balance.toFixed(2) + ' EGP*',
        '📋 Plan: ' + data.plan,
        '🕐 ' + date,
        '🤖 GitHub Cloud' + alertLine
      ].join('\n');
      const tgUrl = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
      const recipients = [TELEGRAM_CHAT_ID];
      if (TELEGRAM_GROUP_ID) recipients.push(TELEGRAM_GROUP_ID);
      for (const chatId of recipients) {
        if (!chatId) continue;
        const tgRes = await fetch(tgUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: chatId, text: msg, parse_mode: 'Markdown' }) });
        if (!tgRes.ok) console.log('  ⚠ Telegram to ' + chatId + ': HTTP ' + tgRes.status);
      }
      console.log('  ✓ Telegram sent!\n');
      if (rem < 30) {
        const criticalMsg = { text: ['🚨🚨🚨 *CRITICAL QUOTA ALERT* 🚨🚨🚨', '', '⚠️ *Cairo Taj - Line 104*', '📉 Only *' + rem.toFixed(2) + ' GB* remaining!', '🔴 *Recharge immediately!*', '', '🕐 ' + date].join('\n'), parse_mode: 'Markdown', disable_notification: false };
        for (const chatId of recipients) { if (!chatId) continue; await fetch(tgUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...criticalMsg, chat_id: chatId }) }); }
        console.log('  🚨 Critical alert sent!\n');
      }
    } catch (e) { console.log('  ⚠ Telegram failed (non-critical):', e.message); }

    console.log('===== SUCCESS =====');

  } catch (error) {
    console.error('\n❌ ERROR:', error.message);
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
      console.log('\n' + '='.repeat(50) + '\nATTEMPT ' + attempt + '/' + MAX_RETRIES + '\n' + '='.repeat(50) + '\n');
      await harvestQuota();
      console.log('\n✅ COMPLETE!');
      process.exit(0);
    } catch (error) {
      console.error('\nAttempt ' + attempt + ' failed: ' + error.message);
      if (error.message && error.message.includes('WE_BLOCKED')) {
        console.error('⛔ WE block detected - stopping all retries');
        console.error('🔁 Will retry on next scheduled run automatically');
        process.exit(1);
      }
      if (attempt < MAX_RETRIES) {
        const d = randomDelay(30000, 45000);
        console.log('Retrying in ' + Math.floor(d/1000) + 's...');
        await sleep(d);
      } else {
        console.error('\n❌ ALL ATTEMPTS FAILED');
        process.exit(1);
      }
    }
  }
}

main();
