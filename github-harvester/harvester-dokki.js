const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fetch = require('node-fetch');

// ============================================================
// TOR INTEGRATION – automatic IP rotation when WE blocks us
// ============================================================
const { execSync, exec } = require('child_process');
const net = require('net');

// Track whether Tor is active in this run
let torActive = false;
let torCircuitCount = 0;

// Start Tor if not already running
async function ensureTor() {
  try {
    execSync('pgrep -x tor', { stdio: 'ignore' });
    console.log('  [TOR] Already running');
  } catch(e) {
    console.log('  [TOR] Starting Tor...');
    try {
      execSync('sudo service tor start', { stdio: 'inherit', timeout: 15000 });
      await sleep(4000); // Wait for Tor to establish circuits
      console.log('  [TOR] Started');
    } catch(e2) {
      console.log('  [TOR] service start failed, trying direct:', e2.message);
      execSync('tor --RunAsDaemon 1 --SocksPort 9050 --ControlPort 9051', { timeout: 5000 });
      await sleep(5000);
    }
  }
  // Verify SOCKS port is open
  await new Promise((resolve, reject) => {
    const s = net.createConnection({ port: 9050, host: '127.0.0.1' }, () => { s.destroy(); resolve(); });
    s.on('error', reject);
    setTimeout(() => reject(new Error('Tor port timeout')), 5000);
  });
  console.log('  [TOR] SOCKS5 port 9050 ready');
}

// Request a new Tor circuit via SIGHUP (no control port needed)
async function rotateTorCircuit() {
  torCircuitCount++;
  console.log('  [TOR] New circuit request #' + torCircuitCount);
  try {
    execSync('sudo kill -HUP $(pgrep -x tor) 2>/dev/null || true', { stdio: 'ignore', timeout: 5000 });
    await sleep(4000);
    console.log('  [TOR] Circuit rotated via SIGHUP');
  } catch(e) {
    console.log('  [TOR] SIGHUP warning (non-fatal):', e.message);
    await sleep(3000);
  }
}

// Launch browser – with or without Tor proxy
async function launchBrowser(useTor) {
  const args = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-blink-features=AutomationControlled',
    '--disable-features=IsolateOrigins,site-per-process',
    '--window-size=1366,768'
  ];
  if (useTor) {
    args.push('--proxy-server=socks5://127.0.0.1:9050');
    console.log('  [TOR] Browser launching through Tor SOCKS5 proxy');
  }
  // Try chromium path first (GitHub Actions), then chrome stable
  const chromePaths = [
    process.env.CHROME_PATH,
    '/opt/hostedtoolcache/setup-chrome/chromium/stable/x64/chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium'
  ].filter(Boolean);

  let execPath = chromePaths[0];
  for (const p of chromePaths) {
    try { execSync('test -f ' + p, { stdio: 'ignore' }); execPath = p; break; } catch(e) {}
  }
  console.log('  [BROWSER] Using:', execPath);

  return await puppeteer.launch({
    headless: true,
    executablePath: execPath,
    protocolTimeout: 60000,
    args,
    ignoreDefaultArgs: ['--enable-automation']
  });
}

// Fetch a URL through Tor using Node's SOCKS5 agent
async function torFetch(url, headers) {
  try {
    const SocksProxyAgent = require('socks-proxy-agent');
    const nodeFetch = require('node-fetch');
    const agent = new SocksProxyAgent.SocksProxyAgent('socks5://127.0.0.1:9050');
    const resp = await nodeFetch(url, { agent, headers, timeout: 12000 });
    if (!resp.ok) return null;
    const buf = await resp.buffer();
    if (buf.length < 100) return null;
    return 'data:image/png;base64,' + buf.toString('base64');
  } catch(e) {
    console.log('  [TOR-FETCH] err:', e.message);
    return null;
  }
}


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
    console.log('===== SUCCESS =====');
      return result;
    } catch (e) {
    console.log('=' + '='.repeat(39));
      if (i === methods.length - 1) throw new Error(`${stepName} ALL METHODS FAILED`);
      await sleep(500);
    }
  }
}

async function harvestQuota() {
  console.log('ًںڑ€ STARTING...\n');
  let browser, page;

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
      if (age > 4 * 60 * 60 * 1000) { console.log('  [SESSION] Cookies expired (>4h old), fresh login'); return null; }
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
    console.log('=' + '='.repeat(39));
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

  try {
    let useTor = false;
    let torRetryCount = 0;
    browser = await launchBrowser(false);

    // Helper to setup a fresh page with stealth settings


    // Rotate User-Agent per run (real Chrome versions, different OS)
    const USER_AGENTS = [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Windows NT 11.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4_1) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36'
    ];
    const VIEWPORTS = [
      { width: 1366, height: 768 },
      { width: 1440, height: 900 },
      { width: 1280, height: 800 },
      { width: 1536, height: 864 },
      { width: 1920, height: 1080 }
    ];
    const chosenUA       = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
    const chosenViewport = VIEWPORTS[Math.floor(Math.random() * VIEWPORTS.length)];
    // Extract Chrome version from UA for client hints
    const chromeVer = (chosenUA.match(/Chrome\/([\d]+)/) || ['','120'])[1];
    console.log('  [STEALTH] UA:', chosenUA.slice(0, 60) + '...');
    console.log('  [STEALTH] Viewport:', chosenViewport.width + 'x' + chosenViewport.height);

    // Human-like mouse movement along a bezier curve
    async function humanMove(targetX, targetY) {
      try {
        const start = await page.evaluate(() => ({ x: window.innerWidth/2, y: window.innerHeight/2 }));
        const cp1x = start.x + (targetX - start.x) * 0.3 + (Math.random() - 0.5) * 80;
        const cp1y = start.y + (targetY - start.y) * 0.1 + (Math.random() - 0.5) * 60;
        const cp2x = start.x + (targetX - start.x) * 0.7 + (Math.random() - 0.5) * 80;
        const cp2y = start.y + (targetY - start.y) * 0.9 + (Math.random() - 0.5) * 60;
        const steps = 12 + Math.floor(Math.random() * 8);
        for (let i = 0; i <= steps; i++) {
          const t = i / steps;
          const x = Math.round((1-t)**3*start.x + 3*(1-t)**2*t*cp1x + 3*(1-t)*t**2*cp2x + t**3*targetX);
          const y = Math.round((1-t)**3*start.y + 3*(1-t)**2*t*cp1y + 3*(1-t)*t**2*cp2y + t**3*targetY);
          await page.mouse.move(x, y);
          await sleep(Math.floor(Math.random() * 18) + 8);
        }
      } catch(e) { /* non-critical */ }
    }

    // Move mouse to an element before clicking it
    async function humanClick(selector) {
      try {
        const el = await page.$(selector);
        if (!el) return false;
        const box = await el.boundingBox();
        if (!box) return false;
        const x = box.x + box.width/2 + (Math.random()-0.5)*6;
        const y = box.y + box.height/2 + (Math.random()-0.5)*4;
        await humanMove(x, y);
        await sleep(randomDelay(80, 200));
        await page.mouse.click(x, y);
        return true;
      } catch(e) { return false; }
    }

    // Random micro-pause (sprinkle between actions to look human)
    async function microPause() {
      await sleep(randomDelay(150, 600));
    }

    async function setupPage() {
      const p = await browser.newPage();

      // Existing stealth injections (unchanged)
      // evaluateOnNewDocument removed - was breaking React SPA rendering
      // Stealth plugin handles bot detection automatically


      // Set Accept-Language to Egyptian Arabic (reduces captcha triggers)
      await p.setExtraHTTPHeaders({
        'sec-ch-ua': '"Chromium";v="' + chromeVer + '", "Google Chrome";v="' + chromeVer + '", "Not-A.Brand";v="99"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
        'DNT': '1'
      });

      await p.setUserAgent(chosenUA);
      await p.setViewport(chosenViewport);
      p.on("dialog", async d => { console.log("  Dialog dismissed:", d.message().slice(0,80)); await d.accept(); });
      return p;
    }

    page = await setupPage();


    // STEP 0: TRY SAVED SESSION COOKIES
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
    console.log('=' + '='.repeat(39));
        } else {
    console.log('=' + '='.repeat(39));
          await clearCookies();
        }
      } catch(e) {
    console.log('=' + '='.repeat(39));
        await clearCookies();
      }
    } else {
      console.log('  No saved session, will do fresh login\n');
    }

    // Dismiss any ads before this step
    await dismissAds();
    // Login loop - restarts through Tor if IP blocked
    let switcherCapturedData = null; // declared outside loop
    async function dismissAds() {
      try {
        const dismissed = await page.evaluate(() => {
          let count = 0;
          // Try all common close button patterns
          const selectors = [
            // SVG X close buttons (top-right of modal)
            'button[class*="close"]',
            'button[aria-label*="close" i]',
            'button[aria-label*="dismiss" i]',
            '[class*="modal"] button[class*="close"]',
            '[class*="popup"] button[class*="close"]',
            '[class*="overlay"] button[class*="close"]',
            // Ant Design modal close
            '.ant-modal-close',
            '.ant-modal-close-x',
            // Generic X buttons not inside the main form
            'button svg[class*="close"]',
            // Close icons by position (top-right absolute/fixed divs)
            '[style*="position: fixed"] button',
            '[style*="position:fixed"] button',
            // Any element with X text that looks like a close button
          ];
          for (const sel of selectors) {
            const els = Array.from(document.querySelectorAll(sel));
            for (const el of els) {
              const rect = el.getBoundingClientRect();
              // Must be visible and not the main login/submit button
              if (rect.width > 0 && rect.height > 0) {
                const text = el.textContent?.trim() || '';
                const isMainAction = /login|submit|confirm|ok$/i.test(text) && text.length > 1;
                if (!isMainAction) {
                  el.click();
                  count++;
                }
              }
            }
          }
          // Also try clicking outside modal (backdrop dismiss)
          const backdrop = document.querySelector('.ant-modal-mask, [class*="backdrop"], [class*="overlay-bg"]');
          if (backdrop && count === 0) { backdrop.click(); count++; }
          return count;
        });
        if (dismissed > 0) {
          console.log('  [AD] Dismissed', dismissed, 'ad/popup element(s)');
          await sleep(1000);
        }
      } catch(e) { /* non-critical */ }
    }

    do {
    torLoginRestart = false;
    console.log('STEP 1: NAVIGATE');
    if (!sessionValid) {
    await tryMethods([
      // M1: EXACT same as working local harvester
      async () => {
        await page.goto('https://my.te.eg/echannel/#/login', { waitUntil: 'networkidle2', timeout: 30000 });
        await page.waitForFunction(() => document.querySelectorAll('input').length >= 2, { timeout: 15000 });
        console.log('    networkidle2 + wait for 2 inputs (local harvester method)');
      },
      // M2: domcontentloaded + wait for 2 inputs
      async () => {
        await page.goto('https://my.te.eg/echannel/#/login', { waitUntil: 'domcontentloaded', timeout: 40000 });
        await page.waitForFunction(() => document.querySelectorAll('input').length >= 2, { timeout: 20000 });
        console.log('    domcontentloaded + wait for 2 inputs');
      },
      // M3: load + wait for 2 inputs
      async () => {
        await page.goto('https://my.te.eg/echannel/#/login', { waitUntil: 'load', timeout: 40000 });
        await page.waitForFunction(() => document.querySelectorAll('input').length >= 2, { timeout: 20000 });
        console.log('    load + wait for 2 inputs');
      },
      // M4: no wait + long sleep + check inputs
      async () => {
        await page.goto('https://my.te.eg/echannel/#/login', { timeout: 40000 });
        await sleep(15000);
        const count = await page.evaluate(() => document.querySelectorAll('input').length);
        if (count < 1) throw new Error(`Only ${count} inputs found`);
        console.log(`    no wait + 15s sleep, found ${count} inputs`);
      },
      // M5: domcontentloaded + very long sleep
      async () => {
        await page.goto('https://my.te.eg/echannel/#/login', { waitUntil: 'domcontentloaded', timeout: 40000 });
        await sleep(8000);
        // Wait up to 25s for SPA to render the login form inputs
        for (let w = 0; w < 25; w++) {
          const cnt = await page.evaluate(() => document.querySelectorAll('input').length);
          if (cnt >= 1) { console.log('    SPA rendered after ' + (8+w) + 's, inputs:', cnt); break; }
          await sleep(1000);
        }
        console.log('    domcontentloaded + wait for SPA render');
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
    // Dismiss any ads before this step
    await dismissAds();
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

    // Wait for dropdown to appear after username triggers React re-render
    console.log('  Waiting for dropdown to appear...');
    await withTimeout(
      page.waitForFunction(() => !!document.querySelector('.ant-select, .ant-select-selector, [class*="select"]'), { timeout: 15000 }),
      16000, 'dropdown appearance'
    ).catch(() => console.log('  [WARN] Dropdown wait timed out, proceeding anyway'));
    await sleep(1000);

    // Log dropdown state
    const dropdownDiag = await withTimeout(page.evaluate(() => ({
      antSelect: !!document.querySelector('.ant-select'),
      antSelectSelector: !!document.querySelector('.ant-select-selector'),
      anySelect: !!document.querySelector('[class*="select"]'),
      selectText: document.querySelector('.ant-select-selector')?.innerText || null
    })), 5000, 'dropdown diag').catch(() => null);
    console.log('  Dropdown state:', JSON.stringify(dropdownDiag));

    // ======================================
    // Dismiss any ads before this step
    await dismissAds();
    console.log('STEP 3: DROPDOWN');
    // ======================================
    await tryMethods([
      // M0: search input - works on updated WE portal
      async () => {
        const si = await page.$('#login_input_type_01');
        if (!si) throw new Error('search input not found');
        await si.click(); await sleep(500);
        await si.evaluate(el => { el.value=''; el.dispatchEvent(new Event('input',{bubbles:true})); });
        await si.type('Internet', { delay: 80 }); await sleep(1000);
        const clicked = await page.evaluate(() => {
          const opts = Array.from(document.querySelectorAll('.ant-select-item-option, li, [class*="option"]'));
          const inet = opts.find(o => o.textContent?.toLowerCase().includes('internet'));
          if (inet) { inet.click(); return inet.textContent.trim(); } return null;
        });
        if (!clicked) { await page.keyboard.press('ArrowDown'); await sleep(300); await page.keyboard.press('Enter'); }
        else { console.log('    M0: search input + clicked:', clicked); }
        await sleep(800);
        const val = await page.evaluate(() => (document.querySelector('.ant-select-selector')?.innerText||'') + (document.querySelector('#login_input_type_01')?.value||''));
        if (!val.toLowerCase().includes('internet')) throw new Error('Internet not confirmed: ' + val);
      },
      // M0: search input (#login_input_type_01) - works on updated WE portal
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
      },
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

    console.log('  [OK] Dropdown done\n');

    // Human-like pause before password
    const delay3 = randomDelay(5000, 8000);
    console.log('  [HUMAN] pause', delay3, 'ms');
    await sleep(delay3);

    // ======================================
    // Dismiss any ads before this step
    await dismissAds();
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
    // Dismiss any ads before this step
    await dismissAds();
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

    if (postLoginState === "blocked" || postLoginState === "unknown") {
      await clearCookies();
      if (torRetryCount >= 2) {
        console.log('  [TOR] Max Tor retries (2) reached - giving up');
        throw new Error('WE_BLOCKED: IP blocked and Tor circuits exhausted');
      }
      torRetryCount++;
      console.log('  [TOR] IP block - switching to Tor (retry ' + torRetryCount + '/2)...');
      try {
        await ensureTor();
        if (browser) { try { await browser.close(); } catch(e2) {} browser = null; }
        await rotateTorCircuit();
        useTor = true; torActive = true;
        browser = await launchBrowser(true);
        page = await setupPage();
        console.log('  [TOR] Browser relaunched through Tor - retrying login...');
        console.log('  [TOR] Browser ready through Tor - restarting login sequence...');
        torLoginRestart = true;
        break; // exit login sequence, restart via loop
      } catch(torErr) {
        if (torErr.message.startsWith('TOR_RETRY')) throw torErr;
        console.log('  [TOR] Setup failed:', torErr.message);
        throw new Error('WE_BLOCKED: IP blocked and Tor setup failed');
      }
    }

    // ======================================
    // CAPTCHA ENGINE v4 (only if captcha was detected)
    // ======================================
    if (postLoginState === 'captcha') {
      console.log('  [CAPTCHA] Ultimate Engine v4 starting...\n');

      // HELPER: Find the captcha image (largest img inside modal)
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
      // then falls back to in-browser XHR, then canvas naturalWidth
      async function fetchCaptchaBase64() {
        try {
          // Step 1: get the image URL from the DOM
          const imgSrc = await page.evaluate(() => {
            const modal = document.querySelector('.ant-modal-content, .ant-modal, [class*="modal"]');
            if (!modal) return null;
            const imgs = Array.from(modal.querySelectorAll('img')).sort((a, b) => {
              const aR = a.getBoundingClientRect(), bR = b.getBoundingClientRect();
              return (bR.width * bR.height) - (aR.width * aR.height);
            });
            for (const img of imgs) {
              const r = img.getBoundingClientRect();
              if (r.width > 80 && r.height > 25) return img.src || img.getAttribute('src');
            }
            return imgs[0]?.src || null;
          });
          if (!imgSrc) { console.log('    [FETCH] No img src found in modal'); return null; }
          if (imgSrc.startsWith('data:image')) return imgSrc;
          console.log('    [FETCH] Image URL:', imgSrc.slice(0, 80));

          try {
            const pageCookies = await page.cookies();
            const cookieStr = pageCookies.map(c => c.name + '=' + c.value).join('; ');
            const headers = {
              'Cookie': cookieStr,
              'Referer': 'https://my.te.eg/',
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
              'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8'
            };
            let nodeResult = null;
            if (torActive) {
              console.log('    [FETCH] Using Tor SOCKS5 for image fetch...');
              nodeResult = await torFetch(imgSrc, headers);
            } else {
              const nodeFetch = require('node-fetch');
              const resp = await nodeFetch(imgSrc, { headers, timeout: 10000 });
              if (resp.ok) {
                const buf = await resp.buffer();
                if (buf.length > 100) nodeResult = 'data:image/png;base64,' + buf.toString('base64');
              }
              if (!nodeResult) console.log('    [FETCH] Node-side resp:', resp ? resp.status : 'no resp');
            }
            if (nodeResult) {
              console.log('    [FETCH] Node-side OK, length:', nodeResult.length);
              return nodeResult;
            }
          } catch(nodeErr) {
            console.log('    [FETCH] Node-side err:', nodeErr.message);
          }

          // Step 3: In-browser XHR fallback
          const b64xhr = await page.evaluate(async (url) => new Promise(resolve => {
            const xhr = new XMLHttpRequest();
            xhr.open('GET', url, true); xhr.responseType = 'blob';
            xhr.onload = () => { const r = new FileReader(); r.onloadend = () => resolve(r.result); r.readAsDataURL(xhr.response); };
            xhr.onerror = xhr.ontimeout = () => resolve(null);
            xhr.timeout = 8000; xhr.send();
          }), imgSrc);
          if (b64xhr) { console.log('    [FETCH] XHR fallback OK'); return b64xhr; }

          // Step 4: fetch() API in browser context
          const b64fetch = await page.evaluate(async (url) => {
            try {
              const r = await fetch(url, { credentials: 'include' });
              if (!r.ok) return null;
              const blob = await r.blob();
              return await new Promise(res => { const fr = new FileReader(); fr.onloadend = () => res(fr.result); fr.readAsDataURL(blob); });
            } catch(e) { return null; }
          }, imgSrc);
          if (b64fetch) { console.log('    [FETCH] browser fetch() OK'); return b64fetch; }

          console.log('    [FETCH] All methods failed for:', imgSrc.slice(0, 60));
          return null;
        } catch(e) { console.log('    [FETCH] err:', e.message); return null; }
      }


      // WE captcha: mixed upper+lower+digits, dot noise background, diagonal line crossing
      // WE captcha: mixed upper+lower+digits, dot noise background, diagonal line
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
            const lum = 0.299*r + 0.587*g + 0.114*b;
            const max = Math.max(r,g,b), min = Math.min(r,g,b);
            const sat = max === 0 ? 0 : (max - min) / max;
            let keep = false;
            if      (f === 'dark')       { keep = lum < 130; }
            else if (f === 'dark2')      { keep = lum < 160; }
            else if (f === 'nodots')     { keep = lum < 120 && sat < 0.6; }
            else if (f === 'color')      { keep = sat > 0.25 && lum < 200; }
            else if (f === 'red')        { keep = r > 80 && (r-g) > 20 && (r-b) > 10; }
            else if (f === 'invert')     { keep = (255-lum) < 130; }
            else if (f === 'thresh120')  { keep = lum < 120; }
            else if (f === 'thresh160')  { keep = lum < 160 && sat < 0.8; }
            else if (f === 'dilate')     { keep = lum < 180 && (r < 160 || g < 160 || b < 160); }
            d[i] = d[i+1] = d[i+2] = keep ? 0 : 255;
            d[i+3] = 255;
          }
          ctx.putImageData(data, 0, 0);
          return c.toDataURL('image/png');
        }, imgHandle, filter);
      }

      async function ocrRead(imageData) {
        const Tesseract = require('tesseract.js');
        const results = [];
        const seen = new Set();
        const whitelist = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        // PSM 8=single word, 7=single line, 6=uniform block, 13=raw line (best for short alphanumeric)
        for (const psm of ['8', '7', '13', '6']) {
          try {
            const r = await Tesseract.recognize(imageData, 'eng', {
              tessedit_char_whitelist: whitelist,
              tessedit_pageseg_mode: psm,
              preserve_interword_spaces: '0'
            });
            const t = r.data.text.replace(/[^A-Za-z0-9]/g, '').trim();
            if (t && !seen.has(t)) { seen.add(t); results.push(t); }
          } catch(e) { /* ignore */ }
        }
        return results;
      }


      // HELPER: Submit captcha answer into modal input
      async function submitAnswer(answer) {
        console.log('    -> Submitting:', answer);
        const ok = await page.evaluate((ans) => {
          const modal = document.querySelector('.ant-modal-content, .ant-modal, [class*="modal"]');
          if (!modal) return false;
          const inp = modal.querySelector('input.ant-input, input[type="text"], input');
          if (!inp) return false;
          inp.focus(); inp.click();
          const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
          setter.call(inp, ''); inp.dispatchEvent(new Event('input', { bubbles: true }));
          setter.call(inp, ans); inp.dispatchEvent(new Event('input', { bubbles: true }));
          inp.dispatchEvent(new Event('change', { bubbles: true }));
          inp.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true }));
          inp.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
          const allBtns = Array.from(modal.querySelectorAll('button'));
          const btn = allBtns.find(b => /ok|confirm|submit|verify/i.test(b.textContent)) ||
                      modal.querySelector('button.ant-btn-primary') ||
                      allBtns[allBtns.length - 1];
          console.log('[captcha] Clicking:', btn ? btn.textContent.trim() : 'none', '/', allBtns.length, 'btns');
          if (btn) btn.click();
          return true;
        }, answer);
        if (!ok) {
          console.log('    -> Keyboard fallback');
          await page.keyboard.press('Tab'); await sleep(300);
          await page.keyboard.type(answer, { delay: 60 });
          await sleep(500); await page.keyboard.press('Enter');
        }
        for (let w = 0; w < 8; w++) {
          await sleep(1000);
          if (!page.url().includes('login')) return true;
          const modalStillOpen = await page.evaluate(() =>
            !!document.querySelector('.ant-modal-content, .ant-modal, [class*="modal"]')
          );
          if (!modalStillOpen) { await sleep(2000); return !page.url().includes('login'); }
        }
        return !page.url().includes('login');
      }

      // HELPER: Check if modal is still open
      async function isModalOpen() {
        return await page.evaluate(() => {
          const modal = document.querySelector('.ant-modal-content, .ant-modal, [class*="modal"]');
          return !!modal;
        });
      }

      // HELPER: Re-trigger captcha by clicking Login again
      async function retriggerLogin() {
        console.log('    -> Modal closed, re-clicking Login...');
        await page.evaluate(() => {
          const btns = Array.from(document.querySelectorAll('button'));
          const btn = btns.find(b => b.textContent.toLowerCase().includes('login') || b.className.includes('primary'));
          if (btn) btn.click();
        });
        // Wait for captcha modal to reappear
        for (let w = 0; w < 15; w++) {
          await sleep(1000);
          const hasModal = await page.evaluate(() => {
            const modal = document.querySelector('.ant-modal-content, .ant-modal, [class*="modal"]');
            return !!modal;
          });
          if (hasModal) {
            console.log('    -> New captcha modal appeared');
            await sleep(2000);
            return true;
          }
          // Check if we navigated away (login succeeded without captcha this time)
          if (!page.url().includes('login')) return false;
        }
        return false;
      }

      const FILTERS = ['dark', 'dark2', 'nodots', 'color', 'red', 'invert', 'thresh120', 'thresh160', 'dilate'];
      let captchaSolved = false;

      for (let round = 1; round <= 4 && !captchaSolved; round++) {
        console.log('  -- Round', round, '/ 4 --');

        // Wait for captcha modal to be present (it appears automatically after wrong answer)
        if (round > 1) {
          let modalFound = false;
          for (let w = 0; w < 10; w++) {
            await sleep(1000);
            const isOpen = await isModalOpen();
            if (isOpen) { modalFound = true; break; }
            // Check if login succeeded (navigated away)
            if (!page.url().includes('login')) {
              captchaSolved = true;
              console.log('  [OK] Navigated away - login succeeded!');
              break;
            }
          }
          if (captchaSolved) break;
          if (!modalFound) {
            // Modal didn't appear - try clicking Login to trigger it
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
          await sleep(1000); // Brief wait for new captcha image to load
        }

        try {
          // M1: Node-side fetch (different network stack, sometimes bypasses IP block)
          let imageData = null;
          for (let retry = 0; retry < 4; retry++) {
            imageData = await fetchCaptchaBase64();
            if (imageData) { console.log('    [FETCH] Image OK, length:', imageData.length); break; }
            await sleep(1500);
          }
          // M2: Canvas img handle (naturalWidth)
          let imgHandle = null;
          for (let retry = 0; retry < 6; retry++) {
            imgHandle = await findCaptchaImg();
            const isValid = await page.evaluate(el => el && el.naturalWidth > 0, imgHandle).catch(() => false);
            if (isValid) break;
            imgHandle = null;
            await sleep(1000);
          }
          if (!imageData && !imgHandle) { console.log('    ! No captcha image from any method'); continue; }

          // Collect OCR candidates across all filters
          const candidates = new Map();
          const addCandidate = (t, score) => {
            if (t && t.length >= 4 && t.length <= 6) {
              const key = t.toLowerCase();
              const existing = [...candidates.keys()].find(k => k.toLowerCase() === key);
              const existingKey = existing || t;
              const bonus = t.length === 5 ? 1 : 0;
              candidates.set(existingKey, (candidates.get(existingKey) || 0) + score + bonus);
            }
          };

          if (imgHandle) {
            for (const filter of FILTERS) {
              const b64 = await canvasProcess(imgHandle, filter);
              if (!b64) continue;
              const texts = await ocrRead(b64);
              console.log('    [canvas-' + filter + '] OCR:', JSON.stringify(texts));
              texts.forEach((t, i) => addCandidate(t, i === 0 ? 2 : 1));
            }
          }
          if (imageData) {
            const texts = await ocrRead(imageData);
            console.log('    [node-ocr] OCR:', JSON.stringify(texts));
            texts.forEach((t, i) => addCandidate(t, i === 0 ? 2 : 1));
          }

          if (candidates.size === 0) { console.log('    ! No valid OCR candidates'); continue; }

          const bestAnswer = [...candidates.entries()].sort((a, b) => b[1] - a[1])[0][0];
          console.log('    Candidates:', JSON.stringify([...candidates.entries()]), '-> best:', bestAnswer);

          const variants = [...new Set([bestAnswer, bestAnswer.toUpperCase(), bestAnswer.toLowerCase()])];
          console.log('    Trying variants:', variants);

          for (const attempt of variants) {
            captchaSolved = await submitAnswer(attempt);
            if (captchaSolved) {
              console.log('  >>> CAPTCHA SOLVED with "' + attempt + '"! <<<');
              break;
            }
            console.log('    X Wrong "' + attempt + '", trying next variant...');
            await sleep(1500);
            const modalStillOpen = await page.evaluate(() =>
              !!document.querySelector('.ant-modal-content, .ant-modal, [class*="modal"]')
            );
            if (!modalStillOpen) break;
          }
          if (!captchaSolved) console.log('    All variants failed, next round...');
        } catch (e) {
          console.log('    ! Error:', e.message);
        }
      }

    }

    // Dismiss any ads before this step
    await dismissAds();
    console.log('STEP 2: SERVICE NUMBER (USERNAME)');
    console.log('===== SUCCESS =====');

    // Save session cookies for next run
    try {
      const cookies = await page.cookies();
      const relevantCookies = cookies.filter(c => c.domain.includes('te.eg') || c.domain.includes('telecomegypt'));
      if (relevantCookies.length > 0) await saveCookies(relevantCookies);
    } catch(e) { console.log('  [SESSION] Could not save cookies:', e.message); }

    } // end if (!sessionValid)

    // WE portal shows promotional ads that can block page content.
    // Dismiss any overlay/ad modal before proceeding.



    // Dismiss any WE promotional ads
    await dismissAds();

    console.log('STEP 5.5: LINE SWITCHER (Dokki)');
    console.log('  Switching to line 0237600094...');
    // Wait for session to fully stabilize before switching lines
    console.log('  Waiting 8s for session to stabilize...');
    await sleep(8000);
    // Verify still logged in before switching
    if (page.url().includes('login')) throw new Error('SESSION_LOST: Redirected to login before line switch');

    // CRITICAL: The WE portal does a session refresh after line switch that can
    // redirect back to #/login within seconds. The only reliable approach is to
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

    await tryMethods([
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

        for (let w = 0; w < 30; w++) {
          await sleep(1000);
          const url = page.url();
          const check = await checkPage094();

          // If stuck on login after 5s, fail this method
          if (url.includes('#/login') && w > 3) throw new Error('Redirected to login after line switch');

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
    console.log('=' + '='.repeat(39));
                return; // SUCCESS
              } else if (captured.balance > 0 && captured.balance < 3000) {
    console.log('=' + '='.repeat(39));
              } else if (captured.balance === 0) {
    console.log('=' + '='.repeat(39));
              } else if (captured.plan === 'Unknown') {
    console.log('=' + '='.repeat(39));
              } else if (totalGB <= 300) {
    console.log('=' + '='.repeat(39));
              } else {
    console.log('=' + '='.repeat(39));
              }
            } else {
    console.log('=' + '='.repeat(39));
            }
          } else {
    console.log('=' + '='.repeat(39));
          }
        }
        throw new Error('M1: Page did not show line 94 FULL data (balance>3000, totalGB>300, plan loaded) in 30s');
      },

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

          if (url.includes('#/login') && w > 3) throw new Error('Redirected to login');

          // ALL 6 conditions must be true for valid capture
          if (check.hasRemaining && check.has094) {
            const captured = await extractNow();
            if (captured) {
              const totalGB = (captured.remaining || 0) + (captured.used || 0);
              if (captured.balance > 3000 && captured.balance > 0 && captured.plan !== 'Unknown' && totalGB > 300) {
                switcherCapturedData = captured;
    console.log('=' + '='.repeat(39));
                return;
              } else if (captured.balance > 0 && captured.balance < 3000) {
    console.log('=' + '='.repeat(39));
              } else if (captured.balance === 0) {
    console.log('=' + '='.repeat(39));
              } else if (captured.plan === 'Unknown') {
    console.log('=' + '='.repeat(39));
              } else if (totalGB <= 300) {
    console.log('=' + '='.repeat(39));
              }
            }
          } else {
    console.log('=' + '='.repeat(39));
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

          if (url.includes('#/login') && w > 3) throw new Error('Redirected to login');

          // ALL 6 conditions must be true for valid capture
          if (check.hasRemaining && check.has094) {
            const captured = await extractNow();
            if (captured) {
              const totalGB = (captured.remaining || 0) + (captured.used || 0);
              if (captured.balance > 3000 && captured.balance > 0 && captured.plan !== 'Unknown' && totalGB > 300) {
                switcherCapturedData = captured;
    console.log('=' + '='.repeat(39));
                return;
              } else if (captured.balance > 0 && captured.balance < 3000) {
    console.log('=' + '='.repeat(39));
              } else if (captured.balance === 0) {
    console.log('=' + '='.repeat(39));
              } else if (captured.plan === 'Unknown') {
    console.log('=' + '='.repeat(39));
              } else if (totalGB <= 300) {
    console.log('=' + '='.repeat(39));
              }
            }
          } else {
    console.log('=' + '='.repeat(39));
          }
        }
        throw new Error('M3: Page did not show line 94 FULL data (balance>3000, totalGB>300, plan loaded) in 25s');
      }
    ], 'LINE SWITCHER', 45000);

    console.log('=' + '='.repeat(39));
    console.log('  Current URL:', page.url(), '\n');

    // Dismiss any WE promotional ads
    await dismissAds();

    } while (torLoginRestart); // restart full login+switch through Tor if needed

    console.log('STEP 6: EXTRACT');


    // Guard: if bounced back to login during navigation, fail fast
    async function checkNotBounced() {
      if (page.url().includes('login')) throw new Error('SESSION_BOUNCED: redirected back to login during extract');
    }
    await checkNotBounced();

    // Use pre-captured data from switcher if available (avoids race condition with redirect)
    // Only fall through to live extraction if switcher didn't capture data
    const data = switcherCapturedData ? await (async () => {
      console.log('  [FAST PATH] Using data captured during line switch (race-condition safe)');
      console.log('    M1 numeric-only sibling scan');
      return switcherCapturedData;
    })() : await tryMethods([
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
        await checkNotBounced();
        await checkNotBounced();
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
        await checkNotBounced();
        const html = await withTimeout(page.content(), 8000, 'page.content');
        await checkNotBounced();
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

    console.log('STEP 7: FIRESTORE');
    const now = new Date().toISOString();
    const fields = {
      'dokki': { mapValue: { fields: {
        quota:    { doubleValue: data.remaining },
        maxQuota: { doubleValue: data.remaining + data.used },
        balance:  { doubleValue: data.balance },
        used:     { doubleValue: data.used },
        plan:     { stringValue: data.plan },
        updatedAt: { stringValue: now },
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

    console.log('=' + '='.repeat(39));

    console.log('STEP 8: LEDGER (quota_history)');
    const historyFields = {
      timestamp: { stringValue: now },
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

    console.log('=' + '='.repeat(39));

    console.log('STEP 8.5: LOW QUOTA FLAG');
    // Write flag to Firestore quota_settings/alerts
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
    console.log('=' + '='.repeat(39));
      } else {
    console.log('=' + '='.repeat(39));
      }
    } catch(e) {
    console.log('=' + '='.repeat(39));
    }

    console.log('STEP 9: TELEGRAM');
    try {
      const date = new Date().toLocaleString('en-GB', {
        timeZone: 'Africa/Cairo',
        day: '2-digit', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit'
      });

      // Quota alert level
      const rem = data.remaining;
      let alertLine = '';

      // Status icon based on level

      const msg = [
        '',
        `${statusIcon} Quota Remaining: *${rem.toFixed(2)} GB*`,
        `ًں“‰ Used: *${data.used.toFixed(2)} GB*`,
        `ًں’° Balance: *${data.balance.toFixed(2)} EGP*`,
        `ًں“‹ Plan: ${data.plan}`,
        `ًں•گ ${date}`,
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
    console.log('=' + '='.repeat(39));
      }
      if (!tgSuccess) throw new Error('All Telegram sends failed');
    console.log('=' + '='.repeat(39));

      if (rem < 30) {
        const criticalMsg = {
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
    console.log('=' + '='.repeat(39));
    }
    console.log('=' + '='.repeat(39));
    console.log('===== SUCCESS =====');
    console.log('=' + '='.repeat(39));

    // Stays in same session, refreshes every 13 minutes, harvests
    if (data.remaining <= 50) {
    console.log('=' + '='.repeat(39));
    console.log('=' + '='.repeat(39));

      const VIGILANCE_INTERVAL_MS = 13 * 60 * 1000;
      const VIGILANCE_MAX_MS      = 5 * 60 * 60 * 1000 + 45 * 60 * 1000;
      const VIGILANCE_STOP_GB     = 2;
      const vigilanceStart        = Date.now();
      let   vigilanceRound        = 0;
      let   lastRemaining         = data.remaining;

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
    console.log('=' + '='.repeat(39));
                return captured;
              }
            }
          }
        }
        throw new Error('Line 094 data not confirmed after 30s');
      }

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
          notes: { stringValue: 'vigilance-mode' },
          dokki: { mapValue: { fields: { quota: { doubleValue: vData.remaining }, balance: { doubleValue: vData.balance } } } },
          '104': { mapValue: { fields: { quota: { nullValue: null }, balance: { nullValue: null } } } },
          gezira: { mapValue: { fields: { quota: { nullValue: null }, balance: { nullValue: null } } } }
        };
        const hUrl = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/quota_history?key=${FIREBASE_API_KEY}`;
        await fetch(hUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fields: vHistory }) });
      }

      async function vigilanceTelegram(vData, vRound, elapsed) {
        try {
          const rem = vData.remaining;
          const elapsedMin = Math.floor(elapsed / 60000);
          const burned = lastRemaining - rem;
          const burnRate = burned > 0 ? (burned / (elapsedMin / 60)).toFixed(2) : '0.00';
          const date = new Date().toLocaleString('en-GB', {
            timeZone: 'Africa/Cairo', day: '2-digit', month: 'short',
            year: 'numeric', hour: '2-digit', minute: '2-digit'
          });
          const icon = rem <= 2 ? 'ًںڑ¨' : rem <= 10 ? 'ًں”´' : rem <= 20 ? 'ًںں ' : 'ًںں،';
          const msg = [
            '',
            icon + ' Quota: *' + rem.toFixed(2) + ' GB* remaining',
            'ًں“‰ Used: *' + vData.used.toFixed(2) + ' GB*',
            'ًں’° Balance: *' + vData.balance.toFixed(2) + ' EGP*',
            'ًں”¥ Burn rate: ~' + burnRate + ' GB/h',
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
    console.log('=' + '='.repeat(39));
    console.log('=' + '='.repeat(39));
      }

      async function vigilanceRestartSession() {
    console.log('=' + '='.repeat(39));
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
    console.log('=' + '='.repeat(39));
            return;
          }
          await clearCookies();
        }
        // Full fresh login
        await tryMethods([
          async () => {
            await page.goto('https://my.te.eg/echannel/#/login', { waitUntil: 'networkidle2', timeout: 30000 });
            await page.waitForFunction(() => document.querySelectorAll('input').length >= 2, { timeout: 15000 });
          },
          async () => {
            await page.goto('https://my.te.eg/echannel/#/login', { waitUntil: 'domcontentloaded', timeout: 40000 });
            await page.waitForFunction(() => document.querySelectorAll('input').length >= 2, { timeout: 20000 });
          }
        ], 'VIGILANCE RE-NAVIGATE', 55000);
        await sleep(randomDelay(3000, 5000));
        await page.focus('#login_loginid_input_01').catch(() => {});
        await sleep(2000);
        await page.type('#login_loginid_input_01', WE_USERNAME, { delay: randomDelay(100, 180) });
        await sleep(randomDelay(4000, 6000));
        await page.waitForFunction(() => !!document.querySelector('.ant-select-selector, .ant-select'), { timeout: 12000 }).catch(() => {});
        await sleep(500);
        const dd = await page.$('.ant-select-selector, .ant-select');
        if (dd) { await dd.click(); await sleep(1500); }
        await page.evaluate(() => {
          for (const el of document.querySelectorAll('.ant-select-item-option, li')) {
            if (el.textContent?.toLowerCase().includes('internet')) { el.click(); return; }
          }
        });
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
    console.log('===== SUCCESS =====');
        try {
          const nc = await page.cookies();
          const rel = nc.filter(c => c.domain.includes('te.eg') || c.domain.includes('telecomegypt'));
          if (rel.length > 0) await saveCookies(rel);
        } catch(e) {}
      }

      while (true) {
        const elapsed = Date.now() - vigilanceStart;
        if (elapsed >= VIGILANCE_MAX_MS) {
    console.log('=' + '='.repeat(39));
          break;
        }
        console.log('\n[VIGILANCE] Waiting 13 minutes for next harvest...');
        await sleep(VIGILANCE_INTERVAL_MS);

        vigilanceRound++;
        const elapsedMin = Math.floor((Date.now() - vigilanceStart) / 60000);
    console.log('=' + '='.repeat(39));
    console.log('=' + '='.repeat(39));
    console.log('=' + '='.repeat(39));

        try {
          // Refresh page + re-switch to 094 (returns confirmed vData directly)
          const vData = await vigilanceRefreshPage();
          console.log('  Remaining: ' + vData.remaining + ' GB | Used: ' + vData.used + ' GB | Balance: ' + vData.balance + ' EGP');

          await vigilanceFirestore(vData);
    console.log('=' + '='.repeat(39));

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
    console.log('=' + '='.repeat(39));

          await vigilanceTelegram(vData, vigilanceRound, Date.now() - vigilanceStart);
          lastRemaining = vData.remaining;

          if (vData.remaining <= VIGILANCE_STOP_GB) {
    console.log('=' + '='.repeat(39));
            console.log('  Vigilance mode complete. Awaiting manual recharge.');
            break;
          }

        } catch (vErr) {
          console.log('  [VIGILANCE] Round #' + vigilanceRound + ' error: ' + vErr.message);
          if (vErr.message.includes('SESSION_DIED') || vErr.message.includes('redirected to login') || vErr.message.includes('ALL METHODS FAILED')) {
    console.log('=' + '='.repeat(39));
            try {
              await vigilanceRestartSession();
              console.log('  [VIGILANCE] Session restarted. Will retry on next round.');
            } catch (restartErr) {
    console.log('=' + '='.repeat(39));
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
    console.log('=' + '='.repeat(39));
      process.exit(0);
    } catch (error) {
      console.error('\nAttempt ' + attempt + ' failed: ' + error.message);
      if (error.message && error.message.includes('WE_BLOCKED')) {
        console.error('ًں”پ Will retry on next scheduled run automatically');
        process.exit(1);
      }
      if (error.message && error.message.startsWith('TOR_RETRY')) {
        console.log('  [TOR] Immediate retry through Tor (not counting as failed)...');
        // Do NOT decrement attempt -- prevents infinite loop
        continue;
      }
      if (error.message && error.message.startsWith('TOR_CIRCUIT_ROTATED')) {
        console.log('  [TOR] Circuit rotated -- retrying in 5s...');
        attempt--;
        await sleep(5000);
        continue;
      }
      if (attempt < MAX_RETRIES) {
        const d = randomDelay(30000, 45000);
        console.log('Retrying in ' + Math.floor(d / 1000) + 's...');
        await sleep(d);
      } else {
        process.exit(1);
      }
    }
  }
}

main();
