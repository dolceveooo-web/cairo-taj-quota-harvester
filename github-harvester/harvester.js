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
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
             '--disable-blink-features=AutomationControlled', '--window-size=1920,1080'],
      ignoreDefaultArgs: ['--enable-automation']
    });

    page = await browser.newPage();
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
      window.navigator.chrome = { runtime: {} };
    });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.setViewport({ width: 1920, height: 1080 });

    // ══════════════════════════════════════
    console.log('STEP 1: NAVIGATE');
    // ══════════════════════════════════════
    await tryMethods([
      async () => {
        await page.goto('https://my.te.eg/echannel/', { waitUntil: 'domcontentloaded', timeout: 40000 });
        await sleep(8000);
      },
      async () => {
        await page.goto('https://my.te.eg/echannel/', { waitUntil: 'networkidle2', timeout: 45000 });
        await sleep(5000);
      },
      async () => {
        await page.goto('https://my.te.eg/echannel/', { waitUntil: 'load', timeout: 40000 });
        await sleep(10000);
      },
      async () => {
        await page.goto('https://my.te.eg/echannel/', { timeout: 40000 });
        await sleep(15000);
      },
      async () => {
        await page.goto('https://my.te.eg/echannel/', { waitUntil: 'domcontentloaded', timeout: 40000 });
        await sleep(20000);
      }
    ], 'NAVIGATE', 55000);

    console.log('  URL:', page.url());

    // ══════════════════════════════════════
    console.log('\nSTEP 2: USERNAME');
    // ══════════════════════════════════════

    // First: dump ALL page info so we know what's there
    console.log('  --- PAGE DIAGNOSTICS ---');
    const diag = await withTimeout(page.evaluate(() => {
      const inputs = Array.from(document.querySelectorAll('input'));
      const allInfo = inputs.map((inp, idx) => ({
        idx,
        id: inp.id,
        name: inp.name,
        type: inp.type,
        placeholder: inp.placeholder,
        visible: inp.offsetParent !== null,
        classes: inp.className
      }));
      return {
        url: window.location.href,
        inputCount: inputs.length,
        inputs: allInfo,
        bodyLength: document.body.innerHTML.length,
        hasAntSelect: !!document.querySelector('.ant-select'),
        hasAntInput: !!document.querySelector('.ant-input')
      };
    }), 10000, 'diagnostics');
    console.log('  URL:', diag.url);
    console.log('  Input count:', diag.inputCount);
    console.log('  Has .ant-select:', diag.hasAntSelect);
    console.log('  Has .ant-input:', diag.hasAntInput);
    console.log('  Body length:', diag.bodyLength);
    diag.inputs.forEach(inp => {
      console.log(`  Input[${inp.idx}]: id="${inp.id}" type="${inp.type}" placeholder="${inp.placeholder}" visible=${inp.visible}`);
    });
    console.log('  --- END DIAGNOSTICS ---');

    await tryMethods([
      // M1: Direct ID
      async () => {
        const el = await page.$('#login_loginid_input_01');
        if (!el) throw new Error('ID not found');
        await el.click(); await sleep(300);
        await el.type(WE_USERNAME, { delay: 60 });
        console.log('    direct ID');
      },
      // M2: ant-input class
      async () => {
        const els = await page.$$('.ant-input');
        if (!els.length) throw new Error('no .ant-input');
        await els[0].click(); await sleep(300);
        await els[0].type(WE_USERNAME, { delay: 60 });
        console.log('    .ant-input class');
      },
      // M3: input[type=text]
      async () => {
        const els = await page.$$('input[type="text"]');
        if (!els.length) throw new Error('no text inputs');
        await els[0].click(); await sleep(300);
        await els[0].type(WE_USERNAME, { delay: 60 });
        console.log('    input[type=text]');
      },
      // M4: any non-password input
      async () => {
        const els = await page.$$('input:not([type="password"]):not([type="hidden"])');
        if (!els.length) throw new Error('no non-password inputs');
        await els[0].click(); await sleep(300);
        await els[0].type(WE_USERNAME, { delay: 60 });
        console.log('    non-password input');
      },
      // M5: DOM evaluate set value
      async () => {
        const ok = await page.evaluate((u) => {
          const inp = document.querySelector('#login_loginid_input_01') ||
                      document.querySelector('.ant-input') ||
                      document.querySelector('input[type="text"]') ||
                      document.querySelector('input:not([type="password"])');
          if (!inp) return false;
          inp.focus();
          inp.value = u;
          inp.dispatchEvent(new Event('input', { bubbles: true }));
          inp.dispatchEvent(new Event('change', { bubbles: true }));
          return true;
        }, WE_USERNAME);
        if (!ok) throw new Error('DOM set failed');
        console.log('    DOM evaluate set value');
      },
      // M6: loop all inputs find visible non-password
      async () => {
        const all = await page.$$('input');
        if (!all.length) throw new Error('no inputs at all');
        for (let i = 0; i < all.length; i++) {
          const info = await all[i].evaluate(el => ({ type: el.type, visible: el.offsetParent !== null }));
          console.log(`    checking input[${i}] type=${info.type} visible=${info.visible}`);
          if (info.type !== 'password' && info.type !== 'hidden' && info.visible) {
            await all[i].click(); await sleep(300);
            await all[i].type(WE_USERNAME, { delay: 60 });
            console.log(`    loop found input[${i}]`);
            return;
          }
        }
        throw new Error('no visible non-password input in loop');
      },
      // M7: keyboard tab to field
      async () => {
        await page.keyboard.press('Tab');
        await sleep(500);
        await page.keyboard.type(WE_USERNAME, { delay: 60 });
        console.log('    keyboard tab + type');
      },
      // M8: React fiber direct value injection
      async () => {
        await sleep(2000);
        const ok = await page.evaluate((u) => {
          const inputs = document.querySelectorAll('input');
          for (let inp of inputs) {
            if (inp.type === 'password' || inp.type === 'hidden') continue;
            const reactKey = Object.keys(inp).find(k => k.startsWith('__reactFiber') || k.startsWith('__reactInternalInstance'));
            if (reactKey) {
              const fiber = inp[reactKey];
              const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
              nativeInputValueSetter.call(inp, u);
              inp.dispatchEvent(new Event('input', { bubbles: true }));
              return true;
            }
          }
          // fallback: just set value on first non-password
          for (let inp of inputs) {
            if (inp.type !== 'password' && inp.type !== 'hidden') {
              const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
              nativeInputValueSetter.call(inp, u);
              inp.dispatchEvent(new Event('input', { bubbles: true }));
              return true;
            }
          }
          return false;
        }, WE_USERNAME);
        if (!ok) throw new Error('React fiber injection failed');
        console.log('    React fiber native value setter');
      }
    ], 'USERNAME', 35000);

    console.log('  ✓ Username done\n');

    // ══════════════════════════════════════
    console.log('STEP 3: DROPDOWN');
    // ══════════════════════════════════════
    await tryMethods([
      async () => {
        await sleep(1000);
        await page.click('.ant-select-selector');
        await sleep(2000);
        await page.evaluate(() => {
          for (let el of document.querySelectorAll('.ant-select-item-option, li')) {
            if (el.textContent?.toLowerCase().includes('internet')) { el.click(); return; }
          }
        });
        console.log('    click selector + evaluate');
      },
      async () => {
        await sleep(1000);
        await page.click('.ant-select');
        await sleep(1500);
        await page.keyboard.press('ArrowDown');
        await sleep(300);
        await page.keyboard.press('Enter');
        console.log('    click + arrow + enter');
      },
      async () => {
        await sleep(1000);
        for (let i = 0; i < 4; i++) {
          await page.click('.ant-select-selector').catch(() => {});
          await sleep(800);
        }
        await page.evaluate(() => {
          for (let el of document.querySelectorAll('li, div, span')) {
            if (el.textContent?.toLowerCase().includes('internet')) { el.click(); return; }
          }
        });
        console.log('    multi-click + broad search');
      },
      async () => {
        await sleep(1000);
        await page.evaluate(() => {
          document.querySelector('.ant-select-selector')?.click();
        });
        await sleep(2000);
        await page.evaluate(() => {
          for (let el of document.querySelectorAll('*')) {
            if (el.textContent?.trim().toLowerCase() === 'internet') { el.click(); return; }
          }
        });
        console.log('    evaluate click + exact match');
      },
      async () => {
        await sleep(1000);
        const els = await page.$$('[class*="select"]');
        if (els.length) { await els[0].click(); await sleep(2000); }
        await page.keyboard.type('Internet');
        await sleep(500);
        await page.keyboard.press('Enter');
        console.log('    generic selector + type');
      }
    ], 'DROPDOWN', 30000);

    console.log('  ✓ Dropdown done\n');

    // ══════════════════════════════════════
    console.log('STEP 4: PASSWORD');
    // ══════════════════════════════════════
    await sleep(1500);
    await tryMethods([
      async () => {
        const el = await page.$('#login_password_input_01');
        if (!el) throw new Error('ID not found');
        await el.click(); await sleep(300);
        await el.type(WE_PASSWORD, { delay: 60 });
        console.log('    direct ID');
      },
      async () => {
        const els = await page.$$('input[type="password"]');
        if (!els.length) throw new Error('no password inputs');
        await els[0].click(); await sleep(300);
        await els[0].type(WE_PASSWORD, { delay: 60 });
        console.log('    input[type=password]');
      },
      async () => {
        const ok = await page.evaluate((p) => {
          const inp = document.querySelector('#login_password_input_01') ||
                      document.querySelector('input[type="password"]');
          if (!inp) return false;
          inp.focus(); inp.value = p;
          inp.dispatchEvent(new Event('input', { bubbles: true }));
          inp.dispatchEvent(new Event('change', { bubbles: true }));
          return true;
        }, WE_PASSWORD);
        if (!ok) throw new Error('DOM set failed');
        console.log('    DOM evaluate set value');
      },
      async () => {
        await page.click('input[type="password"]');
        await sleep(300);
        await page.keyboard.type(WE_PASSWORD, { delay: 60 });
        console.log('    click + keyboard');
      },
      async () => {
        const all = await page.$$('input');
        for (let i = 0; i < all.length; i++) {
          const type = await all[i].evaluate(el => el.type);
          if (type === 'password') {
            await all[i].click(); await sleep(300);
            await all[i].type(WE_PASSWORD, { delay: 60 });
            console.log(`    loop found password input[${i}]`);
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
      async () => {
        await page.evaluate(() => {
          for (let btn of document.querySelectorAll('button')) {
            if (btn.textContent.toLowerCase().includes('login')) { btn.click(); return; }
          }
        });
        await sleep(15000);
        console.log('    find login button');
      },
      async () => {
        await page.keyboard.press('Enter');
        await sleep(15000);
        console.log('    press Enter');
      },
      async () => {
        const btns = await page.$$('button');
        if (btns.length) await btns[0].click();
        await sleep(15000);
        console.log('    first button');
      },
      async () => {
        await page.click('button[type="submit"]').catch(() => {});
        await sleep(15000);
        console.log('    submit button');
      },
      async () => {
        await page.evaluate(() => { document.querySelector('form')?.submit(); });
        await sleep(15000);
        console.log('    form.submit()');
      }
    ], 'SUBMIT', 25000);

    const finalUrl = page.url();
    console.log('  Final URL:', finalUrl);
    if (finalUrl.includes('login')) throw new Error('Still on login page');
    console.log('  ✓ Login successful!\n');

    // ══════════════════════════════════════
    console.log('STEP 6: EXTRACT');
    // ══════════════════════════════════════
    const data = await tryMethods([
      async () => {
        await sleep(5000);
        return await page.evaluate(() => {
          const text = document.body.innerText;
          const r = text.match(/Remaining[^\d]*(\d+\.?\d*)/i);
          const u = text.match(/Used[^\d]*(\d+\.?\d*)/i);
          const b = text.match(/Balance[^\d]*(\d+\.?\d*)/i);
          if (!r) throw new Error('no data');
          return { remaining: parseFloat(r[1]), used: parseFloat(u?.[1]||0), balance: parseFloat(b?.[1]||0) };
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
            if (t?.includes('Balance') && spans[i+1]) balance = parseFloat(spans[i+1].innerText);
          }
          if (remaining === null) throw new Error('no data');
          return { remaining, used: used||0, balance: balance||0 };
        });
      },
      async () => {
        await sleep(10000);
        const html = await withTimeout(page.content(), 8000, 'page.content');
        const r = html.match(/Remaining[^\d]*(\d+\.?\d*)/i);
        const u = html.match(/Used[^\d]*(\d+\.?\d*)/i);
        const b = html.match(/Balance[^\d]*(\d+\.?\d*)/i);
        if (!r) throw new Error('no data in html');
        return { remaining: parseFloat(r[1]), used: parseFloat(u?.[1]||0), balance: parseFloat(b?.[1]||0) };
      },
      async () => {
        await sleep(12000);
        return await page.evaluate(() => {
          const text = document.documentElement.textContent;
          const r = text.match(/(\d+\.?\d*)\s*GB[^\d]*Remaining/i) || text.match(/Remaining[^\d]*(\d+\.?\d*)/i);
          if (!r) throw new Error('no data');
          return { remaining: parseFloat(r[1]), used: 0, balance: 0 };
        });
      },
      async () => {
        await sleep(15000);
        const ss = await withTimeout(page.screenshot({ encoding: 'base64' }), 5000, 'screenshot');
        console.log('    screenshot length:', ss.length);
        throw new Error('data not found - check screenshot');
      }
    ], 'EXTRACT', 35000);

    console.log('  Remaining:', data.remaining, 'GB');
    console.log('  Used:', data.used, 'GB');
    console.log('  Balance:', data.balance, 'EGP\n');

    // ══════════════════════════════════════
    console.log('STEP 7: FIRESTORE');
    // ══════════════════════════════════════
    const fields = {
      remaining: { stringValue: `${data.remaining.toFixed(2)} GB` },
      used: { stringValue: `${data.used.toFixed(2)} GB` },
      total: { stringValue: `${(data.remaining + data.used).toFixed(2)} GB` },
      balance: { stringValue: `${data.balance.toFixed(2)} EGP` },
      planName: { stringValue: 'Unknown' },
      updatedAt: { stringValue: new Date().toISOString() },
      updatedBy: { stringValue: 'GitHub Cloud ⚡' },
      status: { stringValue: 'success' }
    };

    await tryMethods([
      async () => {
        const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/quota_latest/current?key=${FIREBASE_API_KEY}`;
        const res = await fetch(url, { method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fields: { '104': { mapValue: { fields } }, lastUpdate: { stringValue: new Date().toISOString() } } }) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        console.log('    standard PATCH');
      },
      async () => {
        await sleep(2000);
        const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/quota_latest/current?key=${FIREBASE_API_KEY}`;
        const res = await fetch(url, { method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fields: { '104': { mapValue: { fields } }, lastUpdate: { stringValue: new Date().toISOString() } } }) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        console.log('    retry PATCH');
      },
      async () => {
        await sleep(3000);
        const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/quota_latest/current?updateMask.fieldPaths=104&key=${FIREBASE_API_KEY}`;
        const res = await fetch(url, { method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fields: { '104': { mapValue: { fields } } } }) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        console.log('    updateMask PATCH');
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
