// ═══════════════════════════════════════════════════════════════════
// Cairo Taj — Line 104 (Mohandessin) — API-BASED HARVESTER
// Uses WE Egypt's REST API directly — no browser, no Puppeteer,
// no captcha, no login blocks. Pure HTTP calls.
// Based on working we-quota-checker npm package implementation.
// ═══════════════════════════════════════════════════════════════════

const axios = require('axios');
const { wrapper } = require('axios-cookiejar-support');
const { CookieJar } = require('tough-cookie');

const FIREBASE_API_KEY    = process.env.FIREBASE_API_KEY;
const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID;
const WE_USERNAME         = process.env.WE_USERNAME;   // e.g. 0237483361
const WE_PASSWORD         = process.env.WE_PASSWORD;
const TELEGRAM_BOT_TOKEN  = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID    = process.env.TELEGRAM_CHAT_ID;
const TELEGRAM_GROUP_ID   = process.env.TELEGRAM_GROUP_ID;

const MAX_RETRIES = 3;

// Create axios session with persistent cookie jar (matches browser session behavior)
const jar = new CookieJar();
const weSession = wrapper(axios.create({
  baseURL: 'https://api-my.te.eg',
  jar,
  withCredentials: true,
  headers: {
    'Accept':          'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9,ar;q=0.8',
    'Content-Type':    'application/json',
    'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'channelId':       '702',
    'isCoporate':      'false',
    'isMobile':        'false',
    'isSelfcare':      'true',
    'languageCode':    'en-US'
  }
}));

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function randomDelay(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// ── WE API: Step 1 — Init session (required before auth) ──────────
async function weInit() {
  const res = await weSession.post('/echannel/service/besapp/base/rest/busiservice/v1/common/querySysParams', {});
  console.log('  [INIT] Status:', res.status, '— cookies stored in jar');
  console.log('  ✓ WE API session initialized');
}

// ── WE API: Step 2 — Authenticate, returns { token, subscriberId, custName } ──
async function weAuthenticate(acctId, password) {
  const res = await weSession.post(
    '/echannel/service/besapp/base/rest/busiservice/v1/auth/userAuthenticate',
    { acctId, appLocale: 'en-US', password }
  );
  if (res.data.header.retCode !== '0') {
    console.log('  [AUTH] Response:', JSON.stringify(res.data.header));
    throw new Error('WE auth failed: ' + (res.data.header.retMsg || res.data.header.retCode));
  }
  const { customer, subscriber, token } = res.data.body;
  console.log('  ✓ Authenticated as:', customer.custName);
  return { token, subscriberId: subscriber.subscriberId, custName: customer.custName };
}

// ── WE API: Step 3 — Get main offer ID ─────────────────────────────
async function weGetOfferId(acctId, token) {
  const res = await weSession.post(
    '/echannel/service/besapp/base/rest/busiservice/cz/v1/auth/getSubscribedOfferings',
    { msisdn: acctId, numberServiceType: 'FBB', groupId: '' },
    { headers: { csrftoken: token } }
  );
  if (res.data.header.retCode !== '0') {
    throw new Error('WE offerings failed: ' + res.data.header.retCode);
  }
  const offerId = res.data.body.offeringList[0].mainOfferingId;
  console.log('  ✓ Offer ID:', offerId);
  return offerId;
}

// ── WE API: Step 4 — Get quota details ────────────────────────────
async function weGetQuota(token, subscriberId, offerId) {
  const res = await weSession.post(
    '/echannel/service/besapp/base/rest/busiservice/cz/cbs/bb/queryFreeUnit',
    { subscriberId, mainOfferId: offerId },
    { headers: { csrftoken: token } }
  );
  if (res.data.header.retCode !== '0') {
    throw new Error('WE quota failed: ' + res.data.header.retCode);
  }
  const q = res.data.body[0];
  return {
    remaining: q.remain,
    used:      q.used,
    total:     q.total,
    plan:      q.offerName || 'Unknown',
    balance:   q.balance   || 0
  };
}

// ── Firestore: write quota_latest/current (Line 104 field only) ───
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
  console.log('  ✓ Firestore updated (quota_latest/current → 104)');
  return now;
}

// ── Firestore: append to quota_history ledger ──────────────────────
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
  console.log('  ✓ Ledger entry added (quota_history)');
}

// ── Firestore: update low-quota alert flag ─────────────────────────
async function firestoreFlag(remaining) {
  const now = new Date().toISOString();
  const isLow = remaining < 100;
  const fields = {
    line104_low:        { booleanValue: isLow },
    line104_quota:      { doubleValue: remaining },
    line104_updatedAt:  { stringValue: now }
  };
  const mask = 'updateMask.fieldPaths=line104_low&updateMask.fieldPaths=line104_quota&updateMask.fieldPaths=line104_updatedAt';
  const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/quota_settings/alerts?key=${FIREBASE_API_KEY}&${mask}`;
  await axios.patch(url, { fields });
  console.log('  ✓ Alert flag: line104_low=' + isLow + ' (' + remaining.toFixed(1) + ' GB)');
}

// ── Telegram: send message to all recipients ───────────────────────
async function telegramSend(text) {
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  const recipients = [TELEGRAM_CHAT_ID, TELEGRAM_GROUP_ID].filter(Boolean);
  for (const chatId of recipients) {
    try {
      await axios.post(url, { chat_id: chatId, text, parse_mode: 'Markdown' });
    } catch(e) { 
      console.log('  ⚠ Telegram error:', e.message); 
    }
  }
}

// ── Build Telegram message ─────────────────────────────────────────
function buildTelegramMsg(data, label, extraLine) {
  const rem = data.remaining;
  const date = new Date().toLocaleString('en-GB', {
    timeZone: 'Africa/Cairo', day: '2-digit', month: 'short',
    year: 'numeric', hour: '2-digit', minute: '2-digit'
  });
  const icon = rem < 50 ? '🔴' : rem < 100 ? '🟠' : '✅';
  const lines = [
    '📡 *Cairo Taj — ' + label + '*',
    '',
    icon + ' Quota Remaining: *' + rem.toFixed(2) + ' GB*',
    '📉 Used: *' + data.used.toFixed(2) + ' GB*',
    '💰 Balance: *' + (data.balance || 0).toFixed(2) + ' EGP*',
    '📋 Plan: ' + data.plan,
    '🕐 ' + date,
    extraLine || ''
  ].filter(x => x !== '');
  return lines.join('\n');
}

// ── MAIN HARVEST FUNCTION ──────────────────────────────────────────
async function harvestQuota() {
  console.log('🚀 STARTING API HARVEST — Line 104 (Mohandessin)\n');

  // Build account ID: FBB + number without leading 0
  const acctId = 'FBB' + WE_USERNAME.replace(/^0/, '');
  console.log('  Account ID:', acctId);

  // ── STEP 1: Init + Authenticate ──
  console.log('\nSTEP 1: WE API INIT + AUTH');
  await weInit();
  await sleep(randomDelay(500, 1000));
  const { token, subscriberId, custName } = await weAuthenticate(acctId, WE_PASSWORD);

  // ── STEP 2: Get offer + quota ──
  console.log('\nSTEP 2: FETCH QUOTA');
  await sleep(randomDelay(500, 1000));
  const offerId = await weGetOfferId(acctId, token);
  await sleep(randomDelay(500, 1000));
  const data = await weGetQuota(token, subscriberId, offerId);

  console.log('  Remaining: ' + data.remaining + ' GB');
  console.log('  Used:      ' + data.used + ' GB');
  console.log('  Total:     ' + data.total + ' GB');
  console.log('  Balance:   ' + (data.balance || 0) + ' EGP');
  console.log('  Plan:      ' + data.plan);

  // ── STEP 3: Firestore ──
  console.log('\nSTEP 3: FIRESTORE');
  await firestoreWrite(data, 'API Harvester ⚡ Line 104');
  await firestoreLedger(data, 'API Harvester ⚡ Line 104', '');
  await firestoreFlag(data.remaining);

  // ── STEP 4: Telegram ──
  console.log('\nSTEP 4: TELEGRAM');
  const rem = data.remaining;
  let extraLine = '';
  if (rem < 30)       extraLine = '\n🚨 *CRITICAL — Under 30 GB! Recharge immediately!*';
  else if (rem < 50)  extraLine = '\n🔴 *CRITICAL — Under 50 GB!*';
  else if (rem < 100) extraLine = '\n🟠 *WARNING — Under 100 GB*';
  const msg = buildTelegramMsg(data, 'Line 104 Harvest (API)', extraLine ? extraLine.trim() : '🤖 API Harvester ⚡');
  await telegramSend(msg);
  // Double-ring under 30 GB
  if (rem < 30) {
    const date = new Date().toLocaleString('en-GB', { timeZone: 'Africa/Cairo', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    await telegramSend(['🚨🚨🚨 *CRITICAL QUOTA ALERT* 🚨🚨🚨', '', '⚠️ *Cairo Taj — Line 104*', '📉 Only *' + rem.toFixed(2) + ' GB* remaining!', '🔴 *ACTION REQUIRED: Recharge immediately!*', '', '🕐 ' + date].join('\n'));
  }
  console.log('  ✓ Telegram sent');

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('✅ ✅ ✅  SUCCESS  ✅ ✅ ✅');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  // ══════════════════════════════════════════════════════════════
  // VIGILANCE MODE — quota ≤ 50 GB
  // Same token stays valid — just re-call the quota API every 13min
  // Zero extra logins, zero blocks
  // ══════════════════════════════════════════════════════════════
  if (data.remaining <= 50) {
    console.log('\n🔴 VIGILANCE MODE ACTIVATED — ' + data.remaining.toFixed(2) + ' GB ≤ 50 GB');
    console.log('  Every 13 min, re-fetching via API (same token). Stops at ≤ 2 GB or 5h45m.\n');

    const INTERVAL    = 13 * 60 * 1000;
    const MAX_ELAPSED = 5 * 60 * 60 * 1000 + 45 * 60 * 1000;
    const STOP_GB     = 2;
    const startTime   = Date.now();
    let   round       = 0;
    let   lastRem     = data.remaining;
    let   vToken      = token;
    let   vSubscriber = subscriberId;
    let   vOfferId    = offerId;

    // Re-authenticate when token expires
    async function vigilanceReauth() {
      console.log('  [VIGILANCE] Re-authenticating (token refresh)...');
      await weInit();
      await sleep(randomDelay(500, 1000));
      const auth = await weAuthenticate(acctId, WE_PASSWORD);
      vToken      = auth.token;
      vSubscriber = auth.subscriberId;
      vOfferId    = await weGetOfferId(acctId, vToken);
      console.log('  [VIGILANCE] Token refreshed ✓');
    }

    while (true) {
      const elapsed = Date.now() - startTime;
      if (elapsed >= MAX_ELAPSED) {
        console.log('\n[VIGILANCE] 5h 45m cap reached — stopping.');
        break;
      }

      console.log('\n[VIGILANCE] Waiting 13 minutes...');
      await sleep(INTERVAL);
      round++;
      const elapsedMin = Math.floor((Date.now() - startTime) / 60000);
      console.log('\n' + '═'.repeat(50));
      console.log('⚡ VIGILANCE ROUND #' + round + ' — Line 104 (' + elapsedMin + 'min elapsed)');
      console.log('═'.repeat(50));

      try {
        // Re-fetch quota using existing token (no login needed)
        let vData;
        try {
          vData = await weGetQuota(vToken, vSubscriber, vOfferId);
        } catch(tokenErr) {
          // Token expired — re-auth once and retry
          console.log('  [VIGILANCE] Token error: ' + tokenErr.message + ' — refreshing...');
          await vigilanceReauth();
          vData = await weGetQuota(vToken, vSubscriber, vOfferId);
        }

        console.log('  Remaining: ' + vData.remaining + ' GB | Used: ' + vData.used + ' GB');

        // Firestore + Ledger + Flag
        await firestoreWrite(vData, 'API Harvester ⚡ [VIGILANCE] Line 104');
        await firestoreLedger(vData, 'API Harvester ⚡ [VIGILANCE] Line 104', 'vigilance-mode');
        await firestoreFlag(vData.remaining);

        // Burn rate calculation
        const burned   = lastRem - vData.remaining;
        const burnRate = burned > 0 ? (burned / (elapsedMin / 60)).toFixed(2) : '0.00';
        const hoursLeft = parseFloat(burnRate) > 0 ? (vData.remaining / parseFloat(burnRate)).toFixed(1) : '∞';
        const vRem = vData.remaining;
        const vIcon = vRem <= 2 ? '🚨' : vRem <= 10 ? '🔴' : vRem <= 20 ? '🟠' : '🟡';
        const urgency = vRem <= 2  ? '🚨 *STOP — 2 GB! Recharge NOW!*' :
                        vRem <= 5  ? '🔴 *CRITICAL — Under 5 GB!*' :
                        vRem <= 10 ? '🔴 *CRITICAL — Under 10 GB!*' :
                        vRem <= 20 ? '🟠 *WARNING — Under 20 GB*' :
                        vRem <= 30 ? '🟡 *NOTICE — Under 30 GB*' : '';
        const date = new Date().toLocaleString('en-GB', { timeZone: 'Africa/Cairo', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
        const vMsg = [
          '⚡ *Cairo Taj — Line 104 [VIGILANCE MODE]*',
          '',
          vIcon + ' Quota: *' + vRem.toFixed(2) + ' GB* remaining',
          '📉 Used: *' + vData.used.toFixed(2) + ' GB*',
          '💰 Balance: *' + (vData.balance || 0).toFixed(2) + ' EGP*',
          '🔥 Burn rate: ~' + burnRate + ' GB/h',
          '⏱ Est. time left: ~' + hoursLeft + 'h',
          '🔄 Round: #' + round + ' (' + elapsedMin + 'min in)',
          '🕐 ' + date,
          urgency
        ].filter(Boolean).join('\n');

        await telegramSend(vMsg);
        if (vRem <= 10) {
          await telegramSend(['🚨🚨🚨 *VIGILANCE CRITICAL* 🚨🚨🚨', '', '⚠️ *Cairo Taj — Line 104*', '📉 Only *' + vRem.toFixed(2) + ' GB* remaining!', '🔴 *Recharge immediately!*', '', '🕐 ' + date].join('\n'));
        }

        lastRem = vData.remaining;

        if (vData.remaining <= STOP_GB) {
          console.log('\n🚨 [VIGILANCE] ≤ 2 GB reached — stopping.');
          break;
        }

      } catch(vErr) {
        console.log('  [VIGILANCE] Round #' + round + ' error: ' + vErr.message + ' — continuing...');
      }
    }

    console.log('[VIGILANCE] Exiting after ' + round + ' rounds.');
  }
}

// ── MAIN ENTRY POINT ──────────────────────────────────────────────
async function main() {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      console.log('\n' + '═'.repeat(50));
      console.log('ATTEMPT ' + attempt + '/' + MAX_RETRIES);
      console.log('═'.repeat(50) + '\n');
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
