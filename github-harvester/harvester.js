const puppeteer = require('puppeteer-extra');


    // â”€â”€ Anti-Detection Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // Purely additive â€” no existing logic changed or removed.

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
      await p.evaluateOnNewDocument((ua, ver, vp) => {
        window.alert = () => {}; window.confirm = () => true; window.prompt = () => "";
        Object.defineProperty(window, "console", { writable: false, configurable: false });
        Object.defineProperty(navigator, "webdriver", { get: () => false });
        window.navigator.chrome = { runtime: {} };
        Object.defineProperty(navigator, "plugins", { get: () => [1,2,3,4,5] });
        Object.defineProperty(navigator, "languages", { get: () => ["ar-EG","ar","en-US","en"] });

        // Anti-detection additions (purely additive)
        // 1. Fake timezone to Egypt
        const origDateTimeFormat = Intl.DateTimeFormat;
        Intl.DateTimeFormat = function(locale, options) {
          options = options || {};
          if (!options.timeZone) options.timeZone = 'Africa/Cairo';
          return new origDateTimeFormat(locale, options);
        };
        Intl.DateTimeFormat.prototype = origDateTimeFormat.prototype;

        // 2. Canvas fingerprint noise (tiny per-run variation)
        const origGetContext = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function(type, attrs) {
          const ctx = origGetContext.call(this, type, attrs);
          if (type === '2d' && ctx) {
            const origFillText = ctx.fillText.bind(ctx);
            ctx.fillText = function(text, x, y, maxW) {
              return origFillText(text, x + (Math.random() * 0.1 - 0.05), y, maxW);
            };
          }
          return ctx;
        };

        // 3. Fake battery API (bots often lack this)
        Object.defineProperty(navigator, 'getBattery', {
          value: () => Promise.resolve({ charging: true, chargingTime: 0, dischargingTime: Infinity, level: 0.85 + Math.random() * 0.1 }),
          writable: false
        });

        // 4. Fake hardware concurrency (real device)
        Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 });
        Object.defineProperty(navigator, 'deviceMemory', { get: () => 8 });

        // 5. Fake screen matching viewport
        Object.defineProperty(screen, 'width',  { get: () => vp.width });
        Object.defineProperty(screen, 'height', { get: () => vp.height });
        Object.defineProperty(screen, 'availWidth',  { get: () => vp.width });
        Object.defineProperty(screen, 'availHeight', { get: () => vp.height - 40 });

        // 6. Client hints matching UA
        Object.defineProperty(navigator, 'userAgentData', {
          get: () => ({
            brands: [{ brand: 'Chromium', version: ver }, { brand: 'Google Chrome', version: ver }, { brand: 'Not-A.Brand', version: '99' }],
            mobile: false,
            platform: 'Windows',
            getHighEntropyValues: () => Promise.resolve({ platform: 'Windows', platformVersion: '10.0.0', architecture: 'x86', model: '', uaFullVersion: ver + '.0.0.0' })
          })
        });
      }, chosenUA, chromeVer, chosenViewport);

      // Set Accept-Language to Egyptian Arabic (reduces captcha triggers)
      await p.setExtraHTTPHeaders({
        'Accept-Language': 'ar-EG,ar;q=0.9,en-US;q=0.8,en;q=0.7',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
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
    // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    page = await setupPage();

const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fetch = require('node-fetch');

// ============================================================
// TOR INTEGRATION â€” automatic IP rotation when WE blocks us
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

// Request a new Tor circuit (new exit IP)
async function rotateTorCircuit() {
  torCircuitCount++;
  console.log('  [TOR] Requesting new circuit #' + torCircuitCount + '...');
  try {
    // Send NEWNYM signal via Tor control port
    await new Promise((resolve, reject) => {
      const s = net.createConnection({ port: 9051, host: '127.0.0.1' }, () => {
        s.write('AUTHENTICATE ""\r\nSIGNAL NEWNYM\r\nQUIT\r\n');
        s.on('data', () => {});
        s.on('end', resolve);
        setTimeout(() => { s.destroy(); resolve(); }, 3000);
      });
      s.on('error', reject);
    });
    await sleep(3000); // Wait for new circuit to establish
    console.log('  [TOR] New circuit ready');
  } catch(e) {
    console.log('  [TOR] Circuit rotation failed (non-fatal):', e.message);
    await sleep(2000);
  }
}

// Launch browser â€” with or without Tor proxy
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
const WE_USERNAME = process.env.WE_USERNAME;
const WE_PASSWORD = process.env.WE_PASSWORD;
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
      console.log(`  “ Method ${i+1} SUCCESS`);
      return result;
    } catch (e) {
      console.log(`  [FAIL] Method ${i+1} FAILED: ${e.message}`);
      if (i === methods.length - 1) throw new Error(`${stepName} ALL METHODS FAILED`);
      await sleep(500);
    }
  }
}

async function harvestQuota() {
  console.log('🚀 STARTING...\n');
  let browser, page;

  // --- Session Cookie Helpers ---
  // Save/load cookies via Firestore so we can skip login when session is still valid
  // Cookies stored in quota_settings/session_104 as a JSON string
  async function loadSavedCookies() {
    try {
      const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/quota_settings/session_104?key=${FIREBASE_API_KEY}`;
      const res = await fetch(url);
      if (!res.ok) return null;
      const doc = await res.json();
      const cookieStr = doc?.fields?.cookies?.stringValue;
      const savedAt = doc?.fields?.savedAt?.stringValue;
      if (!cookieStr || !savedAt) return null;
      // Only use cookies saved within last 4 hours
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
      console.log('  [SESSION] Cookies saved to Firestore “');
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
  // €€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€

  try {
    let useTor = false;
    browser = await launchBrowser(false);

    // Helper to setup a fresh page with stealth settings

    // â”€â”€ Anti-Detection Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // Purely additive â€” no existing logic changed or removed.

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


    // â”€â”€ Anti-Detection Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // Purely additive â€” no existing logic changed or removed.





    // ======================================
    // STEP 0: TRY SAVED SESSION COOKIES
    // ======================================
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
          console.log('  “ Session still valid! Skipping login entirely.\n');
        } else {
          console.log('  [FAIL] Session expired, clearing and doing fresh login');
          await clearCookies();
        }
      } catch(e) {
        console.log('  [FAIL] Session check failed:', e.message);
        await clearCookies();
      }
    } else {
      console.log('  No saved session, will do fresh login\n');
    }

    // ======================================
    // Dismiss any ads before this step
    await dismissAds();
    console.log('STEP 1: NAVIGATE');
    // ======================================
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
    // Dismiss any ads before this step
    await dismissAds();
    console.log('STEP 3: DROPDOWN');
    // ======================================
    await tryMethods([
      // M0: New search-input style (#login_input_type_01) ” WE updated portal
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
        if (!clicked) { await page.keyboard.press('ArrowDown'); await sleep(300); await page.keyboard.press('Enter'); console.log('    M0: search input + ArrowDown + Enter'); }
        else { console.log('    M0: search input + clicked:', clicked); }
        await sleep(800);
        const val = await page.evaluate(() => (document.querySelector('.ant-select-selector')?.innerText||'') + (document.querySelector('#login_input_type_01')?.value||''));
        if (!val.toLowerCase().includes('internet')) throw new Error('Internet not confirmed: ' + val);
      },
      // M1: Classic ant-select
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
    for (let tick = 0; tick < 30; tick++) {
      const currentUrl = page.url();
      if (!currentUrl.includes('login')) {
        postLoginState = 'navigated';
        console.log('  [OK] URL changed to:', currentUrl);
        break;
      }
      // Check for captcha OR block message
      const pageState = await page.evaluate(() => {
        const modal = document.querySelector('.ant-modal-content, .ant-modal, [class*="modal"], [class*="verification"]');
        const text = document.body.innerText.toLowerCase();
        const hasCaptcha = !!modal || text.includes('verification') || text.includes('enter code');
        // Detect WE block messages
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

    // IP block or silent fail — switch to Tor and retry login
    if (postLoginState === "blocked" || postLoginState === "unknown") {
      await clearCookies();
      if (!useTor) {
        console.log("  [TOR] IP block detected — switching to Tor for retry...");
        try {
          await ensureTor();
          await browser.close(); browser = null;
          await rotateTorCircuit();
          useTor = true; torActive = true;
          browser = await launchBrowser(true);
          page = await setupPage();
          console.log("  [TOR] Browser relaunched through Tor — retrying login...");
          // Jump back to login steps
          throw new Error("TOR_RETRY: Relaunched through Tor, retry needed");
        } catch(torErr) {
          if (torErr.message.startsWith("TOR_RETRY")) throw torErr;
          console.log("  [TOR] Setup failed:", torErr.message, "— giving up");
          throw new Error("WE_BLOCKED: IP blocked and Tor setup failed");
        }
      } else {
        // Already on Tor — rotate circuit and throw to trigger outer retry
        console.log("  [TOR] Already on Tor, rotating circuit...");
        await rotateTorCircuit();
        throw new Error("TOR_CIRCUIT_ROTATED: New circuit, retry login");
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

      // HELPER: Fetch captcha image â€” tries Node-side HTTP first (bypasses browser IP block),
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

          // Step 2: Node-side fetch — route through Tor SOCKS5 if torActive, otherwise direct
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
              if (!nodeResult) console.log('    [FETCH] Node-side resp:', resp ? resp.status : 'no response');
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


      // HELPER: Canvas preprocessing — 6 filters targeting WE captcha
      // WE captcha: mixed upper+lower+digits, dot noise background, diagonal line crossing
      // HELPER: Canvas preprocessing â€” 9 filters targeting WE captcha
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
            // NEW: aggressive binarization â€” kills dots/line completely
            else if (f === 'thresh120')  { keep = lum < 120; }
            // NEW: softer binarization â€” catches faded/light chars
            else if (f === 'thresh160')  { keep = lum < 160 && sat < 0.8; }
            // NEW: dilate effect â€” thicken chars OCR misses by keeping near-dark pixels
            else if (f === 'dilate')     { keep = lum < 180 && (r < 160 || g < 160 || b < 160); }
            d[i] = d[i+1] = d[i+2] = keep ? 0 : 255;
            d[i+3] = 255;
          }
          ctx.putImageData(data, 0, 0);
          return c.toDataURL('image/png');
        }, imgHandle, filter);
      }

      // HELPER: OCR with 4 PSM modes â€” returns all candidate strings
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
        // Wait up to 8s: navigated = success, modal gone = possible redirect pending
        for (let w = 0; w < 8; w++) {
          await sleep(1000);
          if (!page.url().includes('login')) return true;
          const modalStillOpen = await page.evaluate(() =>
            !!document.querySelector('.ant-modal-content, .ant-modal, [class*="modal"]')
          );
          if (!modalStillOpen) {
            await sleep(2000);
            return !page.url().includes('login');
          }
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

      // MAIN CAPTCHA LOOP (6 rounds ” enough to solve, avoids IP block from too many attempts)
      // 6 filters targeting WE captcha: mixed case+digits, dot bg, diagonal line
      // 6 filters targeting WE captcha: mixed case+digits, dot bg, diagonal line
      const FILTERS = ['dark', 'dark2', 'nodots', 'color', 'red', 'invert', 'thresh120', 'thresh160', 'dilate'];
      let captchaSolved = false;

      for (let round = 1; round <= 4 && !captchaSolved; round++) {
        console.log('  -- Round', round, '/ 4 --');

        // Wait for captcha modal (from round 2 onward)
        if (round > 1) {
          let modalFound = false;
          for (let w = 0; w < 10; w++) {
            await sleep(1000);
            if (await isModalOpen()) { modalFound = true; break; }
            if (!page.url().includes('login')) { captchaSolved = true; console.log('  [OK] Navigated - login succeeded!'); break; }
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
            if (!await isModalOpen()) {
              if (!page.url().includes('login')) { captchaSolved = true; break; }
              console.log('    ! Still no modal, skipping round'); continue;
            }
          }
          await sleep(1000);
        }

        try {
          // Fetch image via XHR first (bypasses naturalWidth=0 on datacenter IPs)
          let imageData = null;
          for (let retry = 0; retry < 5; retry++) {
            imageData = await fetchCaptchaBase64();
            if (imageData) { console.log('    [XHR] Image OK, length:', imageData.length); break; }
            await sleep(1500);
          }
          // Canvas img handle as fallback
          let imgHandle = null;
          for (let retry = 0; retry < 6; retry++) {
            imgHandle = await findCaptchaImg();
            const isValid = await page.evaluate(el => el && el.naturalWidth > 0, imgHandle).catch(() => false);
            if (isValid) break;
            imgHandle = null; await sleep(1000);
          }
          if (!imageData && !imgHandle) { console.log('    ! No captcha image from any method'); continue; }

          // Collect all OCR candidates across all filters + score by frequency
          const candidates = new Map();
          const addCandidate = (t, score) => {
            if (t && t.length >= 4 && t.length <= 6) {
              // Case-insensitive dedup: merge 'AbCd' and 'ABCD' as same base
              const key = t.toLowerCase();
              // Prefer the original-case version that scores highest
              const existing = [...candidates.keys()].find(k => k.toLowerCase() === key);
              const existingKey = existing || t;
              const bonus = t.length === 5 ? 1 : 0; // WE captcha is typically 5 chars
              candidates.set(existingKey, (candidates.get(existingKey) || 0) + score + bonus);
            }
          };

          // Canvas filter pass
          if (imgHandle) {
            for (const filter of FILTERS) {
              const b64 = await canvasProcess(imgHandle, filter);
              if (!b64) continue;
              const texts = await ocrRead(b64);
              console.log('    [canvas-' + filter + '] OCR:', JSON.stringify(texts));
              texts.forEach((t, idx) => addCandidate(t, idx === 0 ? 2 : 1));
            }
          }
          // Raw XHR image OCR pass
          if (imageData) {
            const texts = await ocrRead(imageData);
            console.log('    [xhr-raw] OCR:', JSON.stringify(texts));
            texts.forEach((t, idx) => addCandidate(t, idx === 0 ? 2 : 1));
          }

          if (candidates.size === 0) { console.log('    ! No valid answer candidates ” skipping'); continue; }

          // Pick highest-scored candidate
          const bestAnswer = [...candidates.entries()].sort((a, b) => b[1] - a[1])[0][0];
          console.log('    Candidates:', JSON.stringify([...candidates.entries()]), '-> best:', bestAnswer);

          // WE captcha is MIXED case (upper + lower + digits)
          // Try: as-read (preserves mixed case OCR), then all-upper, then all-lower
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
            if (!await isModalOpen()) break; // modal gone ” blocked or solved
          }
          if (!captchaSolved) console.log('    All variants failed, next round...');
        } catch (e) {
          console.log('    ! Error:', e.message);
        }
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

    // ======================================
    // Dismiss any ads before this step
    await dismissAds();
    console.log('STEP 2: SERVICE NUMBER (USERNAME)');
    // ======================================
    console.log('  “ Login successful!\n');

    // Save session cookies for next run (avoids login entirely if session still valid)
    try {
      const cookies = await page.cookies();
      const relevantCookies = cookies.filter(c => c.domain.includes('te.eg') || c.domain.includes('telecomegypt'));
      if (relevantCookies.length > 0) {
        await saveCookies(relevantCookies);
      }
    } catch(e) { console.log('  [SESSION] Could not save cookies:', e.message); }

    } // end if (!sessionValid)

    // â”€â”€ Ad/Popup Dismissal â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // WE portal shows promotional ads that can block page content.
    // Dismiss any overlay/ad modal before proceeding.
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
    // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€


    // Dismiss any WE promotional ads before extracting data
    await dismissAds();

    // ══════════════════════════════════════════
    console.log('STEP 6: EXTRACT');
    // ══════════════════════════════════════════

    // Guard: if we got bounced back to login during navigation, fail fast
    async function checkNotBounced() {
      if (page.url().includes('login')) throw new Error('SESSION_BOUNCED: redirected back to login during extract');
    }

    const data = await tryMethods([
      // M1: Walk ALL spans/divs, find ones whose text is ONLY a decimal number,
      // then check if a nearby sibling contains "Remaining" or "Used"
      async () => {
        await sleep(2000);
        await checkNotBounced();
        // Wait for balance card to load (extra wait if balance not yet visible)
        await withTimeout(
          page.waitForFunction(() => {
            const text = document.body.innerText;
            return text.includes('Current Balance') && /[\d,]+\.?\d+\s*EGP/.test(text);
          }, { timeout: 8000 }),
          9000, 'balance card wait'
        ).catch(() => console.log('    [WARN] Balance card slow, proceeding anyway'));

        await checkNotBounced();

        const result = await page.evaluate(() => {
          const spans = Array.from(document.querySelectorAll('span, div, p'));
          let remaining = null, used = null, balance = null, plan = null;

          // Helper: is this text a plain decimal number (with optional commas)?
          function isNumericText(t) {
            if (!t) return false;
            const stripped = t.replace(/,/g, '').trim();
            return /^\d+(\.\d+)?$/.test(stripped) && !stripped.startsWith('0237') && !stripped.startsWith('023');
          }

          for (let i = 0; i < spans.length; i++) {
            const t = spans[i].innerText?.trim();
            if (!t || t.length > 100) continue;

            // Find "Remaining" label ” check i-1, i-2 for the number
            if (t === 'Remaining') {
              for (let back = 1; back <= 3; back++) {
                if (i - back >= 0) {
                  const candidate = spans[i - back].innerText?.trim();
                  if (isNumericText(candidate)) { remaining = candidate; break; }
                }
              }
            }

            // Find "Used" label ” check i-1, i-2 for the number
            if (t === 'Used') {
              for (let back = 1; back <= 3; back++) {
                if (i - back >= 0) {
                  const candidate = spans[i - back].innerText?.trim();
                  if (isNumericText(candidate)) { used = candidate; break; }
                }
              }
            }

            // Balance: "Current Balance" label then look forward for EGP number
            if (t === 'Current Balance') {
              for (let fwd = 1; fwd <= 8; fwd++) {
                if (i + fwd < spans.length) {
                  const candidate = spans[i + fwd].innerText?.trim();
                  if (isNumericText(candidate)) { balance = candidate; break; }
                }
              }
            }

            // Plan: contains "GB" and "Speed"
            if (t.includes('GB') && t.toLowerCase().includes('speed')) plan = t;
          }

          // Fallback: if balance still not found, try regex on full page text
          if (!balance) {
            const text = document.body.innerText;
            const bMatch = text.match(/Current Balance\s*[\n\r\s]*([\d,]+\.?\d+)/i)
                        || text.match(/([\d,]+\.?\d+)\s*EGP/i);
            if (bMatch) balance = bMatch[1];
          }

          if (!remaining) throw new Error('no remaining found');
          return { remaining, used: used||'0', balance: balance||'0', plan: plan||'Unknown' };
        });
        const parsed = {
          remaining: stripNum(result.remaining),
          used: stripNum(result.used) || 0,
          balance: stripNum(result.balance) || 0,
          plan: result.plan
        };
        if (!parsed.remaining && parsed.remaining !== 0) throw new Error('no data after stripNum');
        console.log('    M1 numeric-only sibling scan');
        return parsed;
      },
      // M2: innerText of whole page, regex number BEFORE label word (on same or adjacent line)
      async () => {
        await sleep(5000);
        await checkNotBounced();
        const result = await page.evaluate(() => {
          const text = document.body.innerText;
          // The page renders: "1,391.34\nRemaining" or "1,391.34 Remaining"
          const r = text.match(/([\d,]+\.?\d+)\s*\n?\s*Remaining/i);
          const u = text.match(/([\d,]+\.?\d+)\s*\n?\s*Used/i);
          const b = text.match(/Current Balance\s*\n?\s*([\d,]+\.?\d+)/i)
                 || text.match(/([\d,]+\.?\d+)\s*EGP/i);
          const p = text.match(/[^\n]*\d+\s*GB[^\n]*[Ss]peed[^\n]*/);
          if (!r) throw new Error('no remaining in page text');
          return {
            remaining: r[1],
            used: u?.[1] || '0',
            balance: b?.[1] || '0',
            plan: p?.[0]?.trim() || 'Unknown'
          };
        });
        const parsed = {
          remaining: stripNum(result.remaining),
          used: stripNum(result.used) || 0,
          balance: stripNum(result.balance) || 0,
          plan: result.plan
        };
        if (!parsed.remaining) throw new Error('no data M2');
        console.log('    M2 page text regex number-before-label');
        return parsed;
      },
      // M3: HTML source regex fallback
      async () => {
        await sleep(8000);
        await checkNotBounced();
        const html = await withTimeout(page.content(), 8000, 'page.content');
        const r = html.match(/>([\d,]+\.?\d+)<[^>]*>\s*(?:<[^>]*>)*\s*Remaining/i);
        const u = html.match(/>([\d,]+\.?\d+)<[^>]*>\s*(?:<[^>]*>)*\s*Used/i);
        const b = html.match(/>([\d,]+\.?\d+)\s*EGP</i);
        if (!r) throw new Error('no data in html');
        return {
          remaining: stripNum(r[1]),
          used: stripNum(u?.[1]) || 0,
          balance: stripNum(b?.[1]) || 0,
          plan: 'Unknown'
        };
      }
    ], 'EXTRACT', 30000);

    console.log('  Remaining:', data.remaining, 'GB');
    console.log('  Used:', data.used, 'GB');
    console.log('  Balance:', data.balance, 'EGP');
    console.log('  Plan:', data.plan, '\n');

    // ======================================
    console.log('STEP 7: FIRESTORE');
    // ======================================
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

    console.log('  “ Uploaded to quota_latest!\n');

    // ======================================
    console.log('STEP 8: LEDGER (quota_history)');
    // ======================================
    const historyFields = {
      timestamp: { stringValue: now },
      user: { stringValue: 'GitHub Cloud' },
      notes: { stringValue: '' },
      dokki: { mapValue: { fields: {
        quota: { nullValue: null },
        balance: { nullValue: null }
      }}},
      '104': { mapValue: { fields: {
        quota: { doubleValue: data.remaining },
        balance: { doubleValue: data.balance }
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

    console.log('  “ Ledger updated!\n');

    // ======================================
    console.log('STEP 8.5: LOW QUOTA FLAG');
    // ======================================
    // Write flag to Firestore quota_settings/alerts
    // line104_low: true  ’ hourly workflow will run full harvest
    // line104_low: false ’ hourly workflow will skip (normal 2h schedule handles it)
    try {
      const isLow104 = data.remaining < 100;
      const alertFields = {
        line104_low:  { booleanValue: isLow104 },
        line104_quota: { doubleValue: data.remaining },
        line104_updatedAt: { stringValue: now }
      };
      const alertMask = 'updateMask.fieldPaths=line104_low&updateMask.fieldPaths=line104_quota&updateMask.fieldPaths=line104_updatedAt';
      const alertUrl = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/quota_settings/alerts?key=${FIREBASE_API_KEY}&${alertMask}`;
      const alertRes = await fetch(alertUrl, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: alertFields })
      });
      if (alertRes.ok) {
        console.log('  “ Low quota flag set: line104_low=' + isLow104 + ' (' + data.remaining.toFixed(1) + ' GB)\n');
      } else {
        console.log('    Flag write failed (non-critical): HTTP ' + alertRes.status);
      }
    } catch(e) {
      console.log('    Flag write error (non-critical):', e.message);
    }    // ======================================
    console.log('STEP 9: TELEGRAM');
    // ======================================
    try {
      const date = new Date().toLocaleString('en-GB', {
        timeZone: 'Africa/Cairo',
        day: '2-digit', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit'
      });

      // Quota alert level
      // Quota alert level
      const rem = data.remaining;
      let alertLine = '';
      if (rem < 30)       alertLine = '\n🚨 *CRITICAL - Under 30 GB! Recharge immediately!*';
      else if (rem < 50)  alertLine = '\n⚠️ *CRITICAL - Under 50 GB!*';
      else if (rem < 100) alertLine = '\n⚠️ *WARNING - Under 100 GB*';

      // Status icon based on level
      const statusIcon = rem < 50 ? '🔴' : rem < 100 ? '🟡' : '🟢';

      const msg = [
        '📊 *Cairo Taj - Line 104 Harvest*',
        '',
        
`${statusIcon} Quota Remaining: *${rem.toFixed(2)} GB*`,
        
`📉 Used: *${data.used.toFixed(2)} GB*`,
        
`💰 Balance: *${data.balance.toFixed(2)} EGP*`,
        
`📋 Plan: ${data.plan}`,
        
`🕐 ${date}`,
        
`🤖 GitHub Cloud` + alertLine
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
        else { console.log('    Telegram to ' + chatId + ': HTTP ' + tgRes.status); }
      }
      if (!tgSuccess) throw new Error('All Telegram sends failed');
      console.log('  “ Telegram sent!\n');

      // CRITICAL ALERT: Under 30 GB ” send a separate urgent message
      // This triggers a second notification/ringtone on the phone
      if (rem < 30) {
        const criticalMsg = {
          text: ['🚨🚨🚨 *CRITICAL QUOTA ALERT* 🚨🚨🚨', '', ' ï¸ڈ *Cairo Taj ” Line 104*',
            `📉 Only *${rem.toFixed(2)} GB* remaining!`, '⚠️ *ACTION REQUIRED: Recharge immediately!*', '', `🕐 ${date}`].join('\n'),
          parse_mode: 'Markdown',
          disable_notification: false
        };
        for (const chatId of recipients) {
          if (!chatId) continue;
          await fetch(tgUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...criticalMsg, chat_id: chatId }) });
        }
        console.log('  🚨 Critical alert sent!\n');
      }

    } catch (e) {
      // Telegram failure should NOT fail the whole harvest
      console.log('    Telegram failed (non-critical):', e.message);
    }
    console.log('پپپپپپپپپپپپپپپپپپپپپپپپپپپپپپپپپپپپپپپپ');
    console.log('… … …  SUCCESS  … … …');
    console.log('پپپپپپپپپپپپپپپپپپپپپپپپپپپپپپپپپپپپپپپپ');

  } catch (error) {
    console.error('\n[ERROR] ERROR:', error.message);
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
      console.log(`\n${'='.repeat(50)}\nATTEMPT ${attempt}/${MAX_RETRIES}\n${'='.repeat(50)}\n`);
      await harvestQuota();
      console.log('\n✅ COMPLETE!');
      process.exit(0);
    } catch (error) {
      console.error(`\nAttempt ${attempt} failed: ${error.message}`);
      // If WE blocked us, don't retry ” it will make things worse
      if (error.message && error.message.includes('WE_BLOCKED')) {
        console.error('⛔ WE block detected - stopping retries to avoid extending the block period');
        console.error('🔁 Will retry on next scheduled run automatically');
        process.exit(1);
      }
      // TOR_RETRY: relaunched through Tor, retry immediately (don't count as failed attempt)
      if (error.message && error.message.startsWith('TOR_RETRY')) {
        console.log('  [TOR] Immediate retry through Tor (not counting as failed attempt)...');
        attempt--; // don't consume a retry slot
        continue;
      }
      // TOR_CIRCUIT_ROTATED: new Tor circuit, wait 5s then retry (don't count as failed)
      if (error.message && error.message.startsWith('TOR_CIRCUIT_ROTATED')) {
        console.log('  [TOR] Circuit rotated -- retrying in 5s (not counting as failed attempt)...');
        attempt--; // don't consume a retry slot
        await sleep(5000);
        continue;
      }
      if (attempt < MAX_RETRIES) {
        const d = randomDelay(30000, 45000);
        console.log(`Retrying in ${Math.floor(d/1000)}s...`);
        await sleep(d);
      } else {
        console.error('\n❌ ALL ATTEMPTS FAILED');
        process.exit(1);
      }
    }
  }
}

main();


