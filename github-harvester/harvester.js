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

    // ══════════════════════════════════════
    console.log('STEP 1: NAVIGATE');
    // ══════════════════════════════════════
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

    // ══════════════════════════════════════
    console.log('STEP 2: SERVICE NUMBER (USERNAME)');
    // ══════════════════════════════════════
    await tryMethods([
      // M1: EXACT same as working local harvester
      async () => {
        await page.focus('#login_loginid_input_01');
        await sleep(200);
        await page.type('#login_loginid_input_01', WE_USERNAME, { delay: 20 });
        await sleep(800);
        console.log('    focus + type (local harvester method)');
      },
      // M2: $ find + click + type
      async () => {
        const el = await page.$('#login_loginid_input_01');
        if (!el) throw new Error('ID not found');
        await el.click(); await sleep(300);
        await el.type(WE_USERNAME, { delay: 30 });
        await sleep(500);
        console.log('    $ find + click + type');
      },
      // M3: .ant-input class
      async () => {
        const els = await page.$$('.ant-input');
        if (!els.length) throw new Error('no .ant-input');
        await els[0].click(); await sleep(300);
        await els[0].type(WE_USERNAME, { delay: 30 });
        await sleep(500);
        console.log('    .ant-input class');
      },
      // M4: input[type=text]
      async () => {
        const els = await page.$$('input[type="text"]');
        if (!els.length) throw new Error('no text inputs');
        await els[0].click(); await sleep(300);
        await els[0].type(WE_USERNAME, { delay: 30 });
        await sleep(500);
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
          // Use native setter to bypass React controlled input
          const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
          nativeSetter.call(inp, u);
          inp.dispatchEvent(new Event('input', { bubbles: true }));
          inp.dispatchEvent(new Event('change', { bubbles: true }));
          return true;
        }, WE_USERNAME);
        if (!ok) throw new Error('DOM set failed');
        await sleep(500);
        console.log('    DOM native setter + React events');
      },
      // M6: loop all inputs, log each, use first visible non-password
      async () => {
        const all = await page.$$('input');
        if (!all.length) throw new Error('no inputs at all');
        for (let i = 0; i < all.length; i++) {
          const info = await all[i].evaluate(el => ({
            type: el.type, visible: el.offsetParent !== null, id: el.id
          }));
          console.log(`    input[${i}] id="${info.id}" type="${info.type}" visible=${info.visible}`);
          if (info.type !== 'password' && info.type !== 'hidden' && info.visible) {
            await all[i].click(); await sleep(300);
            await all[i].type(WE_USERNAME, { delay: 30 });
            await sleep(500);
            console.log(`    used input[${i}]`);
            return;
          }
        }
        throw new Error('no visible non-password input');
      },
      // M7: keyboard Tab from body
      async () => {
        await page.focus('body');
        await sleep(300);
        await page.keyboard.press('Tab');
        await sleep(500);
        await page.keyboard.type(WE_USERNAME, { delay: 30 });
        await sleep(500);
        console.log('    Tab from body + type');
      },
      // M8: click first input regardless of type
      async () => {
        await page.click('input');
        await sleep(300);
        await page.keyboard.type(WE_USERNAME, { delay: 30 });
        await sleep(500);
        console.log('    click first input + keyboard');
      }
    ], 'SERVICE NUMBER', 35000);

    console.log('  ✓ Service number entered\n');

    // Wait for dropdown to appear after username triggers React re-render
    console.log('  Waiting for dropdown to appear...');
    await withTimeout(
      page.waitForFunction(() => !!document.querySelector('.ant-select, .ant-select-selector, [class*="select"]'), { timeout: 15000 }),
      16000, 'dropdown appearance'
    ).catch(() => console.log('  ⚠ Dropdown wait timed out, proceeding anyway'));
    await sleep(1000);

    // Log dropdown state
    const dropdownDiag = await withTimeout(page.evaluate(() => ({
      antSelect: !!document.querySelector('.ant-select'),
      antSelectSelector: !!document.querySelector('.ant-select-selector'),
      anySelect: !!document.querySelector('[class*="select"]'),
      selectText: document.querySelector('.ant-select-selector')?.innerText || null
    })), 5000, 'dropdown diag').catch(() => null);
    console.log('  Dropdown state:', JSON.stringify(dropdownDiag));

    // ══════════════════════════════════════
    console.log('STEP 3: DROPDOWN');
    // ══════════════════════════════════════
    await tryMethods([
      // M1: Wait for dropdown to exist then click
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
      // M2: waitForSelector then click
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
      // M3: click + arrow + enter
      async () => {
        await page.waitForSelector('.ant-select', { timeout: 10000 });
        await page.click('.ant-select');
        await sleep(1500);
        await page.keyboard.press('ArrowDown');
        await sleep(300);
        await page.keyboard.press('Enter');
        console.log('    click + arrow + enter');
      },
      // M4: evaluate click + broad search
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
      },
      // M5: generic selector + type
      async () => {
        await sleep(2000);
        const els = await page.$$('[class*="select"]');
        if (els.length) { await els[0].click(); await sleep(2000); }
        await page.keyboard.type('Internet');
        await sleep(500);
        await page.keyboard.press('Enter');
        console.log('    generic selector + type');
      }
    ], 'DROPDOWN', 20000);

    console.log('  ✓ Dropdown done\n');

    // ══════════════════════════════════════
    console.log('STEP 4: PASSWORD');
    // ══════════════════════════════════════
    await sleep(500);
    await tryMethods([
      // M1: EXACT same as working local harvester
      async () => {
        await page.focus('#login_password_input_01');
        await sleep(200);
        await page.type('#login_password_input_01', WE_PASSWORD, { delay: 20 });
        await sleep(300);
        console.log('    focus + type (local harvester method)');
      },
      // M2: $ find + click + type
      async () => {
        const el = await page.$('#login_password_input_01');
        if (!el) throw new Error('ID not found');
        await el.click(); await sleep(300);
        await el.type(WE_PASSWORD, { delay: 30 });
        console.log('    $ find + click + type');
      },
      // M3: input[type=password]
      async () => {
        const els = await page.$$('input[type="password"]');
        if (!els.length) throw new Error('no password inputs');
        await els[0].click(); await sleep(300);
        await els[0].type(WE_PASSWORD, { delay: 30 });
        console.log('    input[type=password]');
      },
      // M4: DOM native setter
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
      // M5: loop find password
      async () => {
        const all = await page.$$('input');
        for (let i = 0; i < all.length; i++) {
          const type = await all[i].evaluate(el => el.type);
          if (type === 'password') {
            await all[i].click(); await sleep(300);
            await all[i].type(WE_PASSWORD, { delay: 30 });
            console.log(`    loop found password at input[${i}]`);
            return;
          }
        }
        throw new Error('no password input in loop');
      }
    ], 'PASSWORD', 30000);

    console.log('  ✓ Password done\n');

    // ══════════════════════════════════════
    console.log('STEP 5: SUBMIT');
    // ══════════════════════════════════════
    await tryMethods([
      // M1: EXACT same as working local harvester
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

    const finalUrl = page.url();
    console.log('  Final URL:', finalUrl);

    // ══════════════════════════════════════
    // CAPTCHA HANDLER (fallback if still on login)
    // ══════════════════════════════════════
    if (finalUrl.includes('login')) {
      console.log('\n  ⚠ Still on login - checking for captcha...');

      const captchaVisible = await page.evaluate(() => {
        const modal = document.querySelector('.ant-modal-content, .ant-modal, [class*="modal"], [class*="verification"]');
        const title = document.body.innerText;
        return !!modal || title.toLowerCase().includes('verification') || title.toLowerCase().includes('enter code');
      });

      if (!captchaVisible) throw new Error('Still on login page - no captcha detected');

      console.log('  🔐 CAPTCHA DETECTED - attempting to solve...');

      // ── Helper: Find captcha image element precisely ──
      // WE captcha: ~200x58px, NOT a logo/icon/banner, has noisy background
      async function getCaptchaImgElement() {
        return await page.evaluateHandle(() => {
          const imgs = document.querySelectorAll('img');
          // Pass 1: size-based match (captcha is ~120-300w, 30-100h)
          for (const img of imgs) {
            const src = (img.src || '').toLowerCase();
            if (src.includes('logo') || src.includes('icon') || src.includes('banner') || src.includes('sprite')) continue;
            const r = img.getBoundingClientRect();
            if (r.width > 80 && r.width < 350 && r.height > 25 && r.height < 120) return img;
          }
          // Pass 2: URL keyword match
          for (const img of imgs) {
            const src = (img.src || '').toLowerCase();
            if (src.includes('captcha') || src.includes('verify') || src.includes('code') || src.includes('fileid')) return img;
          }
          // Pass 3: img inside modal
          const modalImg = document.querySelector('.ant-modal img, [class*="modal"] img');
          if (modalImg) return modalImg;
          return null;
        });
      }

      // ── Helper: Canvas Red-Isolation preprocessing inside browser ──
      async function canvasPreprocess(imgHandle) {
        return await page.evaluate((imgEl) => {
          if (!imgEl || !imgEl.naturalWidth) return null;
          const scale = 3;
          const c = document.createElement('canvas');
          c.width = imgEl.naturalWidth * scale;
          c.height = imgEl.naturalHeight * scale;
          const ctx = c.getContext('2d');
          ctx.imageSmoothingEnabled = false;
          ctx.drawImage(imgEl, 0, 0, c.width, c.height);
          const imgData = ctx.getImageData(0, 0, c.width, c.height);
          const d = imgData.data;
          // RED ISOLATION: keep only red-ish pixels → black, everything else → white
          for (let i = 0; i < d.length; i += 4) {
            const r = d[i], g = d[i+1], b = d[i+2];
            if (r > 130 && g < 120 && b < 120 && (r - g) > 40) {
              d[i] = d[i+1] = d[i+2] = 0;
            } else {
              d[i] = d[i+1] = d[i+2] = 255;
            }
          }
          ctx.putImageData(imgData, 0, 0);
          return c.toDataURL('image/png');
        }, imgHandle);
      }

      // ── Helper: Canvas Aggressive threshold (fallback) ──
      async function canvasAggressivePreprocess(imgHandle) {
        return await page.evaluate((imgEl) => {
          if (!imgEl || !imgEl.naturalWidth) return null;
          const scale = 4;
          const c = document.createElement('canvas');
          c.width = imgEl.naturalWidth * scale;
          c.height = imgEl.naturalHeight * scale;
          const ctx = c.getContext('2d');
          ctx.imageSmoothingEnabled = false;
          ctx.drawImage(imgEl, 0, 0, c.width, c.height);
          const imgData = ctx.getImageData(0, 0, c.width, c.height);
          const d = imgData.data;
          for (let i = 0; i < d.length; i += 4) {
            const r = d[i], g = d[i+1], b = d[i+2];
            const lum = 0.299*r + 0.587*g + 0.114*b;
            const maxC = Math.max(r,g,b), minC = Math.min(r,g,b);
            const sat = maxC === 0 ? 0 : (maxC - minC) / maxC;
            if (lum < 140 || (sat > 0.4 && lum < 200)) {
              d[i] = d[i+1] = d[i+2] = 0;
            } else {
              d[i] = d[i+1] = d[i+2] = 255;
            }
          }
          ctx.putImageData(imgData, 0, 0);
          return c.toDataURL('image/png');
        }, imgHandle);
      }

      // ── Helper: Run Tesseract OCR ──
      async function runOCR(input, psmMode = '8') {
        const Tesseract = require('tesseract.js');
        const { data: { text } } = await Tesseract.recognize(input, 'eng', {
          tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789',
          tessedit_pageseg_mode: psmMode,
          tessedit_ocr_engine_mode: '1'
        });
        return text.replace(/[^A-Za-z0-9]/g, '').trim();
      }

      // ── Helper: Submit captcha answer ──
      async function submitCaptchaAnswer(answer) {
        console.log('  Submitting answer:', answer);
        const typed = await page.evaluate((ans) => {
          const inp = document.querySelector('#login_input_type_01') ||
                      document.querySelector('.ant-modal input[type="text"]') ||
                      document.querySelector('[class*="modal"] input[type="text"]') ||
                      document.querySelector('input[placeholder*="ode"]') ||
                      document.querySelector('input[type="search"]');
          if (!inp) return false;
          inp.focus();
          const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
          nativeSetter.call(inp, '');
          inp.dispatchEvent(new Event('input', { bubbles: true }));
          nativeSetter.call(inp, ans);
          inp.dispatchEvent(new Event('input', { bubbles: true }));
          inp.dispatchEvent(new Event('change', { bubbles: true }));
          return true;
        }, answer);
        if (!typed) throw new Error('no captcha input found');
        await sleep(500);
        await page.evaluate(() => {
          const btns = document.querySelectorAll('button');
          for (const btn of btns) {
            const t = btn.textContent.toLowerCase();
            if (t.includes('ok') || t === 'ok') { btn.click(); return; }
          }
          if (btns.length) btns[btns.length - 1].click();
        });
        await sleep(5000);
        return !page.url().includes('login');
      }

      // ── Helper: Click refresh on captcha ──
      async function refreshCaptcha() {
        await page.evaluate(() => {
          const els = document.querySelectorAll('button, span, i, svg, img');
          for (const el of els) {
            const cls = (el.className || '').toString().toLowerCase();
            const title = (el.title || '').toLowerCase();
            if (cls.includes('refresh') || cls.includes('reload') || cls.includes('sync') ||
                cls.includes('anticon-sync') || title.includes('refresh')) {
              el.click(); return;
            }
          }
          const imgs = document.querySelectorAll('.ant-modal img, [class*="modal"] img');
          if (imgs.length > 1) imgs[1].click();
        });
        await sleep(2000);
      }

      function isValidCaptcha(text) { return text.length >= 4 && text.length <= 7; }

      let captchaSolved = false;

      // ── C1: Canvas Red-Isolation + OCR PSM8 (BEST for WE red-text captcha) ──
      if (!captchaSolved) {
        try {
          console.log('  [C1] Canvas Red-Isolation + OCR PSM8...');
          const imgHandle = await getCaptchaImgElement();
          const b64 = await canvasPreprocess(imgHandle);
          if (!b64) throw new Error('canvas returned null');
          const text = await runOCR(b64, '8');
          console.log('  [C1] OCR:', text, '(len:', text.length, ')');
          if (isValidCaptcha(text)) {
            captchaSolved = await submitCaptchaAnswer(text);
            if (captchaSolved) console.log('  [C1] ✓ SOLVED!');
          }
        } catch (e) { console.log('  [C1] Failed:', e.message); }
      }

      // ── C2: Canvas Red-Isolation + OCR PSM7 (single line mode) ──
      if (!captchaSolved) {
        try {
          console.log('  [C2] Canvas Red-Isolation + PSM7...');
          const imgHandle = await getCaptchaImgElement();
          const b64 = await canvasPreprocess(imgHandle);
          if (!b64) throw new Error('null');
          const text = await runOCR(b64, '7');
          console.log('  [C2] OCR:', text, '(len:', text.length, ')');
          if (isValidCaptcha(text)) {
            captchaSolved = await submitCaptchaAnswer(text);
            if (captchaSolved) console.log('  [C2] ✓ SOLVED!');
          }
        } catch (e) { console.log('  [C2] Failed:', e.message); }
      }

      // ── C3: Canvas Aggressive threshold + OCR ──
      if (!captchaSolved) {
        try {
          console.log('  [C3] Canvas Aggressive threshold + OCR...');
          const imgHandle = await getCaptchaImgElement();
          const b64 = await canvasAggressivePreprocess(imgHandle);
          if (!b64) throw new Error('null');
          const text = await runOCR(b64, '8');
          console.log('  [C3] OCR:', text, '(len:', text.length, ')');
          if (isValidCaptcha(text)) {
            captchaSolved = await submitCaptchaAnswer(text);
            if (captchaSolved) console.log('  [C3] ✓ SOLVED!');
          }
        } catch (e) { console.log('  [C3] Failed:', e.message); }
      }

      // ── C4: Refresh + Canvas Red-Isolation + OCR (fresh captcha) ──
      if (!captchaSolved) {
        try {
          console.log('  [C4] Refresh + Red-Isolation + OCR...');
          await refreshCaptcha();
          const imgHandle = await getCaptchaImgElement();
          const b64 = await canvasPreprocess(imgHandle);
          if (!b64) throw new Error('null');
          const text = await runOCR(b64, '8');
          console.log('  [C4] OCR:', text, '(len:', text.length, ')');
          if (isValidCaptcha(text)) {
            captchaSolved = await submitCaptchaAnswer(text);
            if (captchaSolved) console.log('  [C4] ✓ SOLVED!');
          }
        } catch (e) { console.log('  [C4] Failed:', e.message); }
      }

      // ── C5: Screenshot element + direct OCR ──
      if (!captchaSolved) {
        try {
          console.log('  [C5] Screenshot element + OCR...');
          await refreshCaptcha();
          const imgHandle = await getCaptchaImgElement();
          const el = imgHandle.asElement ? imgHandle.asElement() : imgHandle;
          if (!el) throw new Error('not element');
          const buf = await el.screenshot();
          if (buf.length < 500) throw new Error('too small');
          const text = await runOCR(buf, '8');
          console.log('  [C5] OCR:', text, '(len:', text.length, ')');
          if (isValidCaptcha(text)) {
            captchaSolved = await submitCaptchaAnswer(text);
            if (captchaSolved) console.log('  [C5] ✓ SOLVED!');
          }
        } catch (e) { console.log('  [C5] Failed:', e.message); }
      }

      // ── C6: Multi-refresh + Red-Isolation loop (3 attempts) ──
      if (!captchaSolved) {
        console.log('  [C6] Multi-refresh loop (3 attempts)...');
        for (let attempt = 0; attempt < 3 && !captchaSolved; attempt++) {
          try {
            await refreshCaptcha();
            const imgHandle = await getCaptchaImgElement();
            const b64 = await canvasPreprocess(imgHandle);
            if (!b64) continue;
            const text = await runOCR(b64, '8');
            console.log(`  [C6] attempt ${attempt+1} OCR:`, text, '(len:', text.length, ')');
            if (isValidCaptcha(text)) {
              captchaSolved = await submitCaptchaAnswer(text);
              if (captchaSolved) console.log('  [C6] ✓ SOLVED!');
            }
          } catch (e) { console.log(`  [C6] attempt ${attempt+1} failed:`, e.message); }
        }
      }

      // ── C7: Cancel + throw to retry whole login ──
      if (!captchaSolved) {
        console.log('  [C7] All methods failed - cancelling...');
        await page.evaluate(() => {
          const btns = document.querySelectorAll('button');
          for (const btn of btns) {
            if (btn.textContent.toLowerCase().includes('cancel')) { btn.click(); return; }
          }
        });
        await sleep(2000);
        throw new Error('Captcha unsolvable - retrying whole login');
      }
    }

    console.log('  ✓ Login successful!\n');

    // ══════════════════════════════════════
    console.log('STEP 6: EXTRACT');
    // ══════════════════════════════════════
    const data = await tryMethods([
      // M1: EXACT same as working local harvester
      async () => {
        await sleep(2000);
        const result = await page.evaluate(() => {
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
          if (!remaining && remaining !== 0) throw new Error('no data');
          return { remaining, used: used||0, balance: balance||0, plan: plan||'Unknown' };
        });
        console.log('    local harvester span method');
        return result;
      },
      async () => {
        await sleep(5000);
        return await page.evaluate(() => {
          const text = document.body.innerText;
          const r = text.match(/Remaining[^\d]*(\d+\.?\d*)/i);
          const u = text.match(/Used[^\d]*(\d+\.?\d*)/i);
          const b = text.match(/Balance[^\d]*(\d+\.?\d*)/i);
          if (!r) throw new Error('no data');
          return { remaining: parseFloat(r[1]), used: parseFloat(u?.[1]||0), balance: parseFloat(b?.[1]||0), plan: 'Unknown' };
        });
      },
      async () => {
        await sleep(8000);
        const html = await withTimeout(page.content(), 8000, 'page.content');
        const r = html.match(/Remaining[^\d]*(\d+\.?\d*)/i);
        if (!r) throw new Error('no data in html');
        return { remaining: parseFloat(r[1]), used: 0, balance: 0, plan: 'Unknown' };
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
        updatedBy: { stringValue: 'GitHub Cloud ⚡' },
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
        console.log('    updateMask PATCH (same as local harvester)');
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

    console.log('  ✓ Uploaded!\n');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('✅ ✅ ✅  SUCCESS  ✅ ✅ ✅');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

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
      console.log(`\n${'═'.repeat(50)}\nATTEMPT ${attempt}/${MAX_RETRIES}\n${'═'.repeat(50)}\n`);
      await harvestQuota();
      console.log('\n🎉 COMPLETE!');
      process.exit(0);
    } catch (error) {
      console.error(`\nAttempt ${attempt} failed: ${error.message}`);
      if (attempt < MAX_RETRIES) {
        const d = randomDelay(30000, 45000);
        console.log(`Retrying in ${Math.floor(d/1000)}s...`);
        await sleep(d);
      } else {
        console.error('\n💀 ALL ATTEMPTS FAILED');
        process.exit(1);
      }
    }
  }
}

main();
