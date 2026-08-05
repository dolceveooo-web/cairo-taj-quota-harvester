// ═══════════════════════════════════════════════════════════════════
// Cairo Taj — Line 104 (Mohandessin) — API-BASED HARVESTER v2
// Uses WE Egypt's proven REST API (older endpoint, confirmed working)
// Flow: generatetoken → status → login → freeunitusage
// No browser, no Puppeteer, no captcha, no login blocks.
// ═══════════════════════════════════════════════════════════════════

const axios = require('axios');
const { wrapper } = require('axios-cookiejar-support');
const { CookieJar } = require('tough-cookie');

const FIREBASE_API_KEY    = process.env.FIREBASE_API_KEY;
const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID;
const WE_USERNAME         = process.env.WE_USERNAME;
const WE_PASSWORD         = process.env.WE_PASSWORD;
const TELEGRAM_BOT_TOKEN  = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID    = process.env.TELEGRAM_CHAT_ID;
const TELEGRAM_GROUP_ID   = process.env.TELEGRAM_GROUP_ID;

const MAX_RETRIES = 3;

const WE_BASE = 'https://api-my.te.eg';

// Create session with cookie jar
const jar = new CookieJar();
const session = wrapper(axios.create({
  jar,
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
    'Accept':       'application/json',
    'User-Agent':   'Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36'
  }
}));

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── WE API Flow ────────────────────────────────────────────────────

// Step 1: Get initial JWT token
async function getToken() {
  const res = await session.get(WE_BASE + '/api/user/generatetoken?channelId=WEB_APP');
  console.log('  [TOKEN] retCode:', res.data?.header?.responseCode);
  if (String(res.data?.header?.responseCode) !== '0') {
    throw new Error('generatetoken failed: ' + res.data?.header?.responseMessage);
  }
  const jwt = res.data.body.jwt;
  session.defaults.headers['Jwt'] = jwt;
  console.log('  ✓ JWT token obtained');
  return jwt;
}

// Step 2: Get status (returns timestamp needed for login)
async function getStatus(msisdn) {
  const res = await session.post(WE_BASE + '/api/user/status', {
    header: { timestamp: 0, customerId: '', msisdn, messageCode: '', locale: 'En' },
    body: {}
  });
  console.log('  [STATUS] retCode:', res.data?.header?.responseCode);
  if (String(res.data?.header?.responseCode) !== '0') {
    throw new Error('status failed: ' + res.data?.header?.responseMessage);
  }
  const timestamp = res.data.header.timstamp; // note: WE API has typo 'timstamp'
  console.log('  ✓ Status obtained, timestamp:', timestamp);
  return timestamp;
}

// Step 3: Login with msisdn + timestamp + password
async function login(msisdn, password, timestamp) {
  const res = await session.post(WE_BASE + '/api/user/login?channelId=WEB_APP', {
    header: { msisdn, timestamp: String(timestamp), locale: 'En' },
    body:   { password }
  });
  console.log('  [LOGIN] retCode:', res.data?.header?.responseCode);
  if (String(res.data?.header?.responseCode) !== '0') {
    throw new Error('login failed: ' + res.data?.header?.responseMessage);
  }
  // Update JWT with the new post-login JWT
  const newJwt = res.data.body.jwt;
  const customerId = res.data.header.customerId;
  session.defaults.headers['Jwt'] = newJwt;
  console.log('  ✓ Logged in! customerId:', customerId);
  return { customerId, jwt: newJwt };
}

// Step 4: Get quota data
async function getFreeUnitUsage(msisdn, customerId) {
  const res = await session.post(WE_BASE + '/api/line/freeunitusage', {
    header: { customerId, msisdn, locale: 'En' },
    body:   {}
  });
  console.log('  [QUOTA] retCode:', res.data?.header?.responseCode);
  if (String(res.data?.header?.responseCode) !== '0') {
    throw new Error('freeunitusage failed: ' + res.data?.header?.responseMessage);
  }
  const body = res.data.body;
  console.log('  [QUOTA] Raw body:', JSON.stringify(body).slice(0, 300));
  return body;
}

// ── Parse quota data from response ────────────────────────────────
function parseQuotaData(body) {
  // Find the main internet bundle
  let remaining = 0, used = 0, total = 0, plan = 'Unknown', balance = 0;

  // Try different response structures
  if (body.freeUnitUsageList) {
    const units = body.freeUnitUsageList;
    for (const unit of units) {
      if (unit.usedUnit !== undefined && unit.remainingUnit !== undefined) {
        remaining = parseFloat(unit.remainingUnit) || 0;
        used = parseFloat(unit.usedUnit) || 0;
        total = remaining + used;
        plan = unit.offerName || unit.bundleName || 'Unknown';
        break;
      }
    }
  } else if (body.bundleList) {
    const bundle = body.bundleList[0];
    remaining = parseFloat(bundle.remainingData || bundle.remaining || 0);
    used = parseFloat(bundle.usedData || bundle.used || 0);
    total = remaining + used;
    plan = bundle.name || bundle.offerName || 'Unknown';
  } else if (body.remain !== undefined) {
    remaining = parseFloat(body.remain) || 0;
    used = parseFloat(body.used) || 0;
    total = parseFloat(body.total) || remaining + used;
    plan = body.offerName || 'Unknown';
    balance = parseFloat(body.balance) || 0;
  }

  // Try to get balance from accountBalance
  if (body.accountBalance !== undefined) {
    balance = parseFloat(body.accountBalance) || balance;
  }

  return { remaining, used, total, plan, balance };
}

// ── Firestore write ────────────────────────────────────────────────
async function firestoreWrite(data, updatedBy) {
  const now = new Date().toISOString();
  const fields = {
    '104': { mapValue: { fields: {
      quota:     { doubleValue: data.remaining },
      maxQuota:  { doubleValue: data.total },
      balance:   { doubleValue: data.balance },
      used:      { doubleValue: data.used },
      plan:      { stringValue: data.plan },
      updatedAt: { stringValue: now },
      updatedBy: { stringValue: updatedBy },
      status:    { stringValue: 'success' }
    }}},
    lastUpdate: { stringValue: now }
  };
  const mask = 'updateMask.fieldPaths=%60104%60&updateMask.fieldPaths=lastUpdate';
  const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/quota_latest/current?key=${FIREBASE_API_KEY}&${mask}`;
  await axios.patch(url, { fields });
  console.log('  ✓ Firestore updated → 104');
}

async function firestoreLedger(data, updatedBy, notes) {
  const now = new Date().toISOString();
  const fields = {
    timestamp: { stringValue: now },
    user:      { stringValue: updatedBy },
    notes:     { stringValue: notes || '' },
    dokki:     { mapValue: { fields: { quota: { nullValue: null }, balance: { nullValue: null } } } },
    '104':     { mapValue: { fields: { quota: { doubleValue: data.remaining }, balance: { doubleValue: data.balance } } } },
    gezira:    { mapValue: { fields: { quota: { nullValue: null }, balance: { nullValue: null } } } }
  };
  const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/quota_history?key=${FIREBASE_API_KEY}`;
  await axios.post(url, { fields });
  console.log('  ✓ Ledger entry added');
}

async function firestoreFlag(remaining) {
  const now = new Date().toISOString();
  const isLow = remaining < 100;
  const fields = {
    line104_low:       { booleanValue: isLow },
    line104_quota:     { doubleValue: remaining },
    line104_updatedAt: { stringValue: now }
  };
  const mask = 'updateMask.fieldPaths=line104_low&updateMask.fieldPaths=line104_quota&updateMask.fieldPaths=line104_updatedAt';
  const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/quota_settings/alerts?key=${FIREBASE_API_KEY}&${mask}`;
  await axios.patch(url, { fields });
  console.log('  ✓ Alert flag: line104_low=' + isLow);
}

// ── Telegram ───────────────────────────────────────────────────────
async function telegramSend(text) {
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  const recipients = [TELEGRAM_CHAT_ID, TELEGRAM_GROUP_ID].filter(Boolean);
  for (const chatId of recipients) {
    try {
      await axios.post(url, { chat_id: chatId, text, parse_mode: 'Markdown' });
    } catch(e) { console.log('  ⚠ Telegram error:', e.message); }
  }
}

// ── MAIN HARVEST ───────────────────────────────────────────────────
async function harvestQuota() {
  console.log('🚀 STARTING API HARVEST v2 — Line 104 (Mohandessin)\n');
  console.log('  Username:', WE_USERNAME, '| Password length:', WE_PASSWORD ? WE_PASSWORD.length : 0);

  // Step 1-3: Authenticate
  console.log('\nSTEP 1: AUTHENTICATE');
  await getToken();
  await sleep(500);
  const timestamp = await getStatus(WE_USERNAME);
  await sleep(500);
  const { customerId } = await login(WE_USERNAME, WE_PASSWORD, timestamp);

  // Step 4: Get quota
  console.log('\nSTEP 2: FETCH QUOTA');
  await sleep(500);
  const body = await getFreeUnitUsage(WE_USERNAME, customerId);
  const data = parseQuotaData(body);

  console.log('\n  Remaining: ' + data.remaining + ' GB');
  console.log('  Used:      ' + data.used + ' GB');
  console.log('  Total:     ' + data.total + ' GB');
  console.log('  Balance:   ' + data.balance + ' EGP');
  console.log('  Plan:      ' + data.plan);

  // Step 5: Firestore
  console.log('\nSTEP 3: FIRESTORE');
  await firestoreWrite(data, 'API Harvester ⚡ Line 104');
  await firestoreLedger(data, 'API Harvester ⚡ Line 104', '');
  await firestoreFlag(data.remaining);

  // Step 6: Telegram
  console.log('\nSTEP 4: TELEGRAM');
  const rem = data.remaining;
  const date = new Date().toLocaleString('en-GB', { timeZone: 'Africa/Cairo', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const icon = rem < 50 ? '🔴' : rem < 100 ? '🟠' : '✅';
  let extra = '';
  if (rem < 30)       extra = '\n🚨 *CRITICAL — Under 30 GB! Recharge immediately!*';
  else if (rem < 50)  extra = '\n🔴 *CRITICAL — Under 50 GB!*';
  else if (rem < 100) extra = '\n🟠 *WARNING — Under 100 GB*';
  const msg = [
    '📡 *Cairo Taj — Line 104 Harvest (API v2)*',
    '',
    icon + ' Quota Remaining: *' + rem.toFixed(2) + ' GB*',
    '📉 Used: *' + data.used.toFixed(2) + ' GB*',
    '💰 Balance: *' + data.balance.toFixed(2) + ' EGP*',
    '📋 Plan: ' + data.plan,
    '🕐 ' + date,
    '🤖 API Harvester ⚡' + extra
  ].join('\n');
  await telegramSend(msg);
  if (rem < 30) {
    await telegramSend(['🚨🚨🚨 *CRITICAL QUOTA ALERT* 🚨🚨🚨', '', '⚠️ *Cairo Taj — Line 104*', '📉 Only *' + rem.toFixed(2) + ' GB* remaining!', '🔴 *Recharge immediately!*', '', '🕐 ' + date].join('\n'));
  }
  console.log('  ✓ Telegram sent');

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('✅ ✅ ✅  SUCCESS  ✅ ✅ ✅');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  // Vigilance mode
  if (data.remaining <= 50) {
    console.log('\n🔴 VIGILANCE MODE — ' + data.remaining.toFixed(2) + ' GB ≤ 50 GB');
    const INTERVAL = 13 * 60 * 1000;
    const MAX_ELAPSED = 5 * 60 * 60 * 1000 + 45 * 60 * 1000;
    const STOP_GB = 2;
    const startTime = Date.now();
    let round = 0, lastRem = data.remaining;
    let vCustomerId = customerId;

    while (true) {
      if (Date.now() - startTime >= MAX_ELAPSED) { console.log('\n[VIGILANCE] Time cap reached.'); break; }
      console.log('\n[VIGILANCE] Waiting 13 minutes...');
      await sleep(INTERVAL);
      round++;
      const elapsedMin = Math.floor((Date.now() - startTime) / 60000);
      console.log('⚡ VIGILANCE ROUND #' + round + ' (' + elapsedMin + 'min)');
      try {
        let vBody;
        try {
          vBody = await getFreeUnitUsage(WE_USERNAME, vCustomerId);
        } catch(e) {
          // Re-auth
          console.log('  [VIGILANCE] Re-authenticating...');
          await getToken();
          const ts = await getStatus(WE_USERNAME);
          const auth = await login(WE_USERNAME, WE_PASSWORD, ts);
          vCustomerId = auth.customerId;
          vBody = await getFreeUnitUsage(WE_USERNAME, vCustomerId);
        }
        const vData = parseQuotaData(vBody);
        console.log('  Remaining: ' + vData.remaining + ' GB');
        await firestoreWrite(vData, 'API Harvester ⚡ [VIGILANCE] Line 104');
        await firestoreLedger(vData, 'API Harvester ⚡ [VIGILANCE] Line 104', 'vigilance-mode');
        await firestoreFlag(vData.remaining);
        const burned = lastRem - vData.remaining;
        const burnRate = burned > 0 ? (burned / (elapsedMin / 60)).toFixed(2) : '0.00';
        const hoursLeft = parseFloat(burnRate) > 0 ? (vData.remaining / parseFloat(burnRate)).toFixed(1) : '∞';
        const vRem = vData.remaining;
        const vIcon = vRem <= 2 ? '🚨' : vRem <= 10 ? '🔴' : vRem <= 20 ? '🟠' : '🟡';
        const urgency = vRem <= 2 ? '🚨 *STOP — 2 GB! Recharge NOW!*' : vRem <= 5 ? '🔴 *CRITICAL — Under 5 GB!*' : vRem <= 10 ? '🔴 *CRITICAL — Under 10 GB!*' : vRem <= 20 ? '🟠 *WARNING — Under 20 GB*' : vRem <= 30 ? '🟡 *NOTICE — Under 30 GB*' : '';
        const vDate = new Date().toLocaleString('en-GB', { timeZone: 'Africa/Cairo', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
        await telegramSend(['⚡ *Cairo Taj — Line 104 [VIGILANCE]*', '', vIcon + ' Quota: *' + vRem.toFixed(2) + ' GB*', '📉 Used: *' + vData.used.toFixed(2) + ' GB*', '💰 Balance: *' + vData.balance.toFixed(2) + ' EGP*', '🔥 Burn: ~' + burnRate + ' GB/h', '⏱ Est: ~' + hoursLeft + 'h', '🔄 Round #' + round + ' (' + elapsedMin + 'min)', '🕐 ' + vDate, urgency].filter(Boolean).join('\n'));
        if (vRem <= 10) await telegramSend(['🚨🚨🚨 *VIGILANCE CRITICAL* 🚨🚨🚨', '⚠️ *Line 104: Only *' + vRem.toFixed(2) + ' GB*!', '🔴 *Recharge now!*', '🕐 ' + vDate].join('\n'));
        lastRem = vData.remaining;
        if (vData.remaining <= STOP_GB) { console.log('\n🚨 [VIGILANCE] ≤ 2 GB — stopping.'); break; }
      } catch(vErr) { console.log('  [VIGILANCE] Error: ' + vErr.message); }
    }
    console.log('[VIGILANCE] Done after ' + round + ' rounds.');
  }
}

async function main() {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      console.log('\n' + '═'.repeat(50) + '\nATTEMPT ' + attempt + '/' + MAX_RETRIES + '\n' + '═'.repeat(50) + '\n');
      await harvestQuota();
      console.log('\n🎉 COMPLETE!');
      process.exit(0);
    } catch (error) {
      console.error('\nAttempt ' + attempt + ' failed: ' + error.message);
      if (attempt < MAX_RETRIES) {
        const d = Math.floor(Math.random() * 15000) + 10000;
        console.log('Retrying in ' + Math.floor(d / 1000) + 's...');
        await sleep(d);
      } else {
        console.error('\n💀 ALL ATTEMPTS FAILED');
        process.exit(1);
      }
    }
  }
}

main();
