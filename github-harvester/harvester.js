const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fetch = require('node-fetch');

puppeteer.use(StealthPlugin());

const FIREBASE_API_KEY = process.env.FIREBASE_API_KEY;
const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID;
const WE_USERNAME = process.env.WE_USERNAME;
const WE_PASSWORD = process.env.WE_PASSWORD;

async function harvestQuota() {
  console.log('🚀 GitHub Cloud Harvester starting...');
  
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu'
      ]
    });

    const page = await browser.newPage();
    
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
      window.console.debug = () => {};
    });
    
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    
    console.log('1️⃣ Navigating to WE Egypt login...');
    await page.goto('https://my.te.eg/echannel/', { waitUntil: 'networkidle2', timeout: 30000 });
    
    await page.waitForFunction(() => document.querySelectorAll('input').length >= 2, { timeout: 15000 });
    console.log('  Login form ready');
    
    console.log('2️⃣ Filling username...');
    await page.focus('#login_loginid_input_01');
    await new Promise(r => setTimeout(r, 200));
    await page.type('#login_loginid_input_01', WE_USERNAME, { delay: 20 });
    await new Promise(r => setTimeout(r, 800));
    
    console.log('3️⃣ Selecting service type (Internet)...');
    
    // Try multiple dropdown selectors
    let dropdown = await page.$('.ant-select-selector');
    if (!dropdown) dropdown = await page.$('.ant-select');
    if (!dropdown) dropdown = await page.$('[class*="select"]');
    
    if (dropdown) {
      console.log('  Found dropdown, clicking...');
      await dropdown.click();
      await new Promise(r => setTimeout(r, 1000));
    } else {
      console.log('  Dropdown not found, trying direct evaluation...');
      await page.evaluate(() => {
        const selects = document.querySelectorAll('[class*="select"], select, .ant-select');
        if (selects[0]) selects[0].click();
      });
      await new Promise(r => setTimeout(r, 1000));
    }
    
    const clicked = await page.evaluate(() => {
      const items = Array.from(document.querySelectorAll('.ant-select-item-option, .ant-select-item, li, [class*="option"]'));
      console.log('Found ' + items.length + ' dropdown items');
      const internet = items.find(i => i.textContent && i.textContent.toLowerCase().includes('internet'));
      if (internet) { 
        internet.click(); 
        return internet.textContent.trim(); 
      }
      // Fallback: click first item that looks like an option
      if (items.length > 0) {
        items[0].click();
        return items[0].textContent.trim();
      }
      return null;
    });
    console.log('  Selected: ' + (clicked || 'FAILED'));
    await new Promise(r => setTimeout(r, 1000));
    
    console.log('4️⃣ Filling password...');
    await page.focus('#login_password_input_01');
    await new Promise(r => setTimeout(r, 200));
    await page.type('#login_password_input_01', WE_PASSWORD, { delay: 20 });
    await new Promise(r => setTimeout(r, 300));
    
    console.log('5️⃣ Submitting login...');
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const btn = btns.find(b => b.textContent.toLowerCase().includes('login') || b.className.includes('primary'));
      if (btn) btn.click();
    });
    await new Promise(r => setTimeout(r, 6000));
    
    const urlAfter = page.url();
    console.log('  URL: ' + urlAfter);
    if (urlAfter.includes('#/login')) throw new Error('Login failed — check credentials');
    console.log('  ✓ Login successful');
    
    console.log('6️⃣ Extracting quota data...');
    await new Promise(r => setTimeout(r, 2000));
    
    const data = await page.evaluate(() => {
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

      return { remaining, used, total, balance, plan };
    });
    
    console.log('7️⃣ Data extracted:', data);
    console.log('  Remaining: ' + data.remaining + ' GB');
    console.log('  Used: ' + data.used + ' GB');
    console.log('  Total: ' + data.total + ' GB');
    console.log('  Balance: ' + data.balance + ' EGP');
    console.log('  Plan: ' + data.plan);
    
    if (!data.remaining) throw new Error('Could not extract quota from page');
    
    const remaining = data.remaining;
    const used = data.used;
    const total = data.total;
    const balance = data.balance;
    
    const quotaData = {
      '104': {
        remaining: `${remaining.toFixed(2)} GB`,
        used: `${used.toFixed(2)} GB`,
        total: `${total.toFixed(2)} GB`,
        balance: `${balance.toFixed(2)} EGP`,
        planName: data.plan || 'Unknown Plan',
        updatedAt: new Date().toISOString(),
        updatedBy: 'GitHub Cloud Harvester ⚡',
        status: 'success'
      },
      lastUpdate: new Date().toISOString()
    };
    
    console.log('8️⃣ Writing to Firestore...');
    
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
      throw new Error(`Firestore write failed: ${response.statusText}`);
    }
    
    console.log('✅ GitHub Cloud Harvester completed successfully!');
    
  } catch (error) {
    console.error('❌ GitHub Cloud Harvester error:', error);
    process.exit(1);
  } finally {
    if (browser) await browser.close();
  }
}

harvestQuota();
