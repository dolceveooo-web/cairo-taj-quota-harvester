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
    await page.goto('https://my.te.eg/echannel/', { waitUntil: 'networkidle2', timeout: 60000 });
    
    console.log('2️⃣ Filling username...');
    await page.waitForSelector('input[name="username"]', { timeout: 30000 });
    await page.type('input[name="username"]', WE_USERNAME);
    
    console.log('3️⃣ Selecting service type (Internet)...');
    await page.waitForSelector('select[name="serviceType"]', { timeout: 10000 });
    await page.select('select[name="serviceType"]', 'Internet');
    
    console.log('4️⃣ Filling password...');
    await page.waitForSelector('input[name="password"]', { timeout: 10000 });
    await page.type('input[name="password"]', WE_PASSWORD);
    
    console.log('5️⃣ Submitting login...');
    await Promise.all([
      page.click('button[type="submit"]'),
      page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 60000 })
    ]);
    
    console.log('6️⃣ Extracting quota data...');
    await page.waitForTimeout(3000);
    
    const data = await page.evaluate(() => {
      const getText = (label) => {
        const spans = Array.from(document.querySelectorAll('span'));
        const labelSpan = spans.find(s => s.textContent.includes(label));
        if (!labelSpan) return null;
        const valueSpan = labelSpan.nextElementSibling || labelSpan.parentElement.nextElementSibling;
        return valueSpan ? valueSpan.textContent.trim() : null;
      };
      
      return {
        remaining: getText('Remaining'),
        used: getText('Used'),
        balance: getText('Current Balance'),
        planName: getText('Plan Name') || getText('Package')
      };
    });
    
    console.log('7️⃣ Data extracted:', data);
    
    const remaining = parseFloat(data.remaining) || 0;
    const used = parseFloat(data.used) || 0;
    const total = remaining + used;
    const balance = parseFloat(data.balance) || 0;
    
    const quotaData = {
      '104': {
        remaining: `${remaining.toFixed(2)} GB`,
        used: `${used.toFixed(2)} GB`,
        total: `${total.toFixed(2)} GB`,
        balance: `${balance.toFixed(2)} EGP`,
        planName: data.planName || 'Unknown Plan',
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
