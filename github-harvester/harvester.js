const puppeteer = require('./functions/node_modules/puppeteer-extra');
const StealthPlugin = require('./functions/node_modules/puppeteer-extra-plugin-stealth');
const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');

puppeteer.use(StealthPlugin());

const WE_USERNAME = process.env.WE_USERNAME;
const WE_PASSWORD = process.env.WE_PASSWORD;
const FIREBASE_API_KEY = process.env.FIREBASE_API_KEY;
const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID;

const MAX_RETRIES = 3;

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function randomDelay(min, max) { return Math.floor(Math.random() * (max - min + 1) + min); }

async function withTimeout(promise, ms, label) {
  const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms));
  return Promise.race([promise, timeout]);
}

async function tryMethods(methods, stepLabel, totalTimeout) {
  for (let i = 0; i < methods.length; i++) {
    try {
      console.log(`  [${i + 1}/${methods.length}]`);
      const result = await withTimeout(methods[i](), totalTimeout / methods.length, `${stepLabel} Method ${i + 1}`);
      console.log(`  ✓ Method ${i + 1} SUCCESS`);
      return result;
    } catch (e) {
      console.log(`  ⚠ Method ${i + 1} failed: ${e.message}`);
    }
  }
  throw new Error(`All methods for ${stepLabel} failed`);
}

async function harvestQuota() {
  let browser, page;
  try {
    console.log('🚀 STARTING...');
    browser = await puppeteer.launch({
      headless: "new",
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-blink-features=AutomationControlled', '--lang=en-US,en']
    });
    page = await browser.newPage();
    
    await page.evaluateOnNewDocument(() => {
      window.alert = () => {};
      window.confirm = () => true;
      window.prompt = () => '';
      Object.defineProperty(window, 'console', { writable: false, configurable: false });
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

    console.log('STEP 1: NAVIGATE');
    await tryMethods([
      async () => {
        await page.goto('https://my.te.eg/echannel/', { waitUntil: 'networkidle2', timeout: 30000 });
        await page.waitForFunction(() => document.querySelectorAll('input').length >= 2, { timeout: 15000 });
      }
    ], 'NAVIGATE', 40000);

    console.log('STEP 2: SERVICE NUMBER');
    await tryMethods([
      async () => {
        await page.focus('#login_loginid_input_01');
        await page.type('#login_loginid_input_01', WE_USERNAME, { delay: 20 });
        await sleep(800);
      }
    ], 'SERVICE NUMBER', 20000);

    await sleep(1000);
    console.log('STEP 3: DROPDOWN');
    await tryMethods([
      async () => {
        await page.waitForSelector('.ant-select-selector', { timeout: 10000 });
        await page.click('.ant-select-selector');
        await sleep(1500);
        await page.evaluate(() => {
          const items = Array.from(document.querySelectorAll('.ant-select-item-option, li'));
          const internet = items.find(i => i.textContent.toLowerCase().includes('internet'));
          if (internet) internet.click();
        });
        await sleep(500);
      }
    ], 'DROPDOWN', 15000);

    console.log('STEP 4: PASSWORD');
    await tryMethods([
      async () => {
        await page.focus('#login_password_input_01');
        await page.type('#login_password_input_01', WE_PASSWORD, { delay: 20 });
        await sleep(300);
      }
    ], 'PASSWORD', 20000);

    console.log('STEP 5: SUBMIT');
    await tryMethods([
      async () => {
        await page.evaluate(() => {
          const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.toLowerCase().includes('login'));
          if (btn) btn.click();
        });
        await sleep(6000);
      }
    ], 'SUBMIT', 15000);

    const finalUrl = page.url();
    if (finalUrl.includes('login')) {
      console.log('  🔐 CAPTCHA DETECTED - attempting to solve...');

      async function getCaptchaImgElement() {
        return await page.evaluateHandle(() => {
          const modal = document.querySelector('.ant-modal-content, .ant-modal, [class*="modal"]');
          const imgs = (modal || document.body).querySelectorAll('img');
          for (const img of imgs) {
            const src = (img.src || '').toLowerCase();
            if (src.includes('logo') || src.includes('icon') || src.includes('banner') || src.includes('apple') || src.includes('google')) continue;
            const r = img.getBoundingClientRect();
            if (r.width > 100 && r.width < 300 && r.height > 30 && r.height < 100) return img;
          }
          return null;
        });
      }

      async function canvasPreprocess(imgHandle) {
        return await page.evaluate((imgEl) => {
          if (!imgEl || !imgEl.naturalWidth) return null;
          const scale = 3;
          const c = document.createElement('canvas');
          c.width = imgEl.naturalWidth * scale;
          c.height = imgEl.naturalHeight * scale;
          const ctx = c.getContext('2d');
          ctx.drawImage(imgEl, 0, 0, c.width, c.height);
          const imgData = ctx.getImageData(0, 0, c.width, c.height);
          const d = imgData.data;
          for (let i = 0; i < d.length; i += 4) {
            const r = d[i], g = d[i+1], b = d[i+2];
            if (r > 130 && g < 120 && b < 120 && (r - g) > 40) { d[i] = d[i+1] = d[i+2] = 0; }
            else { d[i] = d[i+1] = d[i+2] = 255; }
          }
          ctx.putImageData(imgData, 0, 0);
          return c.toDataURL('image/png');
        }, imgHandle);
      }

      async function runOCR(input, psm = '8') {
        const Tesseract = require('tesseract.js');
        const { data: { text } } = await Tesseract.recognize(input, 'eng', { tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789', tessedit_pageseg_mode: psm });
        return text.replace(/[^A-Za-z0-9]/g, '').trim();
      }

      async function typeCaptchaAnswer(answer) {
        console.log('  Typing answer:', answer);
        const success = await page.evaluate((ans) => {
          const modal = document.querySelector('.ant-modal-content, .ant-modal, [class*="modal"]');
          const inp = modal?.querySelector('input.ant-input, input[type="text"]');
          if (!inp) return false;
          const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
          setter.call(inp, ans);
          inp.dispatchEvent(new Event('input', { bubbles: true }));
          return true;
        }, answer);
        
        await sleep(500);
        await page.evaluate(() => {
          const btn = document.querySelector('.ant-modal button.ant-btn-primary, .ant-modal button');
          if (btn) btn.click();
        });
        await sleep(5000);
        return !page.url().includes('login');
      }

      async function refreshCaptcha() {
        await page.evaluate(() => {
          const modal = document.querySelector('.ant-modal-content, .ant-modal');
          const refresh = modal?.querySelector('i[class*="refresh"], span[class*="refresh"], .anticon-sync');
          if (refresh) refresh.click();
        });
        await sleep(3000);
      }

      let solved = false;
      for (let round = 0; round < 8 && !solved; round++) {
        if (round > 0) await refreshCaptcha();
        try {
          const img = await getCaptchaImgElement();
          const b64 = await canvasPreprocess(img);
          if (!b64) continue;
          let text = await runOCR(b64, '8');
          console.log(`  [Round ${round+1}] OCR: ${text}`);
          if (text.length === 5) solved = await typeCaptchaAnswer(text);
        } catch (e) { console.log(`  [Round ${round+1}] Error: ${e.message}`); }
      }
      if (!solved) throw new Error('Captcha failed');
    }

    console.log('STEP 6: EXTRACT');
    const data = await page.evaluate(() => {
      const spans = Array.from(document.querySelectorAll('span, div'));
      let remaining = null, used = null, balance = null, plan = null;
      for (let i = 0; i < spans.length; i++) {
        const t = spans[i].innerText?.trim();
        if (t === 'Remaining' && spans[i-1]) remaining = parseFloat(spans[i-1].innerText);
        if (t === 'Used' && spans[i-1]) used = parseFloat(spans[i-1].innerText);
        if (t === 'Current Balance' && spans[i+1]) balance = parseFloat(spans[i+1].innerText);
        if (t && t.includes('GB') && t.toLowerCase().includes('speed')) plan = t;
      }
      return { remaining, used: used||0, balance: balance||0, plan: plan||'Unknown' };
    });

    console.log('STEP 7: FIRESTORE');
    const now = new Date().toISOString();
    const fields = {
      '104': { mapValue: { fields: {
        quota: { doubleValue: data.remaining },
        maxQuota: { doubleValue: data.remaining + data.used },
        balance: { doubleValue: data.balance },
        used: { doubleValue: data.used },
        plan: { stringValue: data.plan },
        updatedAt: { stringValue: now },
        updatedBy: { stringValue: 'GitHub Cloud ⚡' },
        status: { stringValue: 'success' }
      }}},
      lastUpdate: { stringValue: now }
    };
    const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/quota_latest/current?key=${FIREBASE_API_KEY}&updateMask.fieldPaths=%60104%60&updateMask.fieldPaths=lastUpdate`;
    await fetch(url, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fields }) });

    console.log('✅ SUCCESS');
  } finally {
    if (browser) await browser.close();
  }
}

async function main() {
  for (let i = 1; i <= MAX_RETRIES; i++) {
    try {
      await harvestQuota();
      process.exit(0);
    } catch (e) {
      console.log(`Attempt ${i} failed: ${e.message}`);
      if (i < MAX_RETRIES) await sleep(30000);
    }
  }
  process.exit(1);
}
main();
