# Changes Summary - harvester.js

## Function Signature Changes

### tryMultipleMethods
**BEFORE**: `async function tryMultipleMethods(methodsArray, stepName)`
**AFTER**: `async function tryMultipleMethods(methodsArray, stepName, timeout = 20000)`
- Added configurable timeout parameter (default 20s)

## Step-by-Step Changes

### STEP 1: Navigation
**Methods**: 3 → **4 methods**
**Timeout**: 15s → **35s**
**New Method 2**: networkidle0 wait strategy (waits for all network requests to finish)
**Improvements**: 
- Wait for .ant-select selector after navigation
- Extended sleep times (3-6 seconds)

### STEP 2: Username
**Methods**: 3 (unchanged)
**Timeout**: 15s → **20s**
**No structural changes** - already working

### STEP 3: Service Type Dropdown ⚡ CRITICAL
**Methods**: 3 → **6 METHODS**
**Timeout**: 15s → **25s**

**NEW Method 1**: Wait for selector → 1s sleep → Click → 1.5s sleep → Wait for options → Click Internet
**NEW Method 2**: Focus → Enter → Type "Internet" → Enter
**NEW Method 3**: MutationObserver pattern (watches DOM for option appearance)
**NEW Method 4**: Triple-click dropdown with 800ms delays → Search multiple selectors
**NEW Method 5**: Tab from username field → Space → Type → Enter
**NEW Method 6**: React fiber access + event triggering + delayed fallback

### STEP 4: Password
**Methods**: 3 → **4 methods**
**Timeout**: 15s → **20s**
**NEW**: Dropdown verification log before password input
**NEW**: Extended wait (1.5s from 1s)
**NEW Method 4**: Click field + keyboard type
**Improvement**: Typing delay 20ms → 30ms

### STEP 5: Submit
**No changes** - already working in previous tests

### STEP 6: Extract
**No changes** - not reached yet

### STEP 7: Firestore
**No changes** - not reached yet

## Error Handling Improvements

### Added to catch block:
```javascript
// Screenshot capture
const screenshot = await page.screenshot({ encoding: 'base64', fullPage: false });

// Page state diagnostics
const pageState = await page.evaluate(() => ({
  url: window.location.href,
  title: document.title,
  dropdownExists: !!document.querySelector('.ant-select'),
  dropdownValue: document.querySelector('.ant-select-selection-item')?.textContent || null,
  usernameValue: document.querySelector('#login_loginid_input_01')?.value || null,
  passwordFilled: !!document.querySelector('#login_password_input_01')?.value,
  visibleText: document.body.innerText.substring(0, 500)
}));
```

## Browser Launch Improvements
**Added**: `'--window-size=1366,768'` to args array
**Changed**: `const page` → `let page` (for error handler access)

## Total Execution Time
**Before**: ~3-5 minutes per attempt
**After**: Up to 10 minutes per attempt (but higher success rate)

## Success Probability Calculation
**Before**: 3 methods × 3 attempts = 9 total tries
**After**: 6 methods × 3 attempts = 18 total tries
**Improvement**: 2× more attempts at dropdown selection

## Lines of Code
**Before**: ~380 lines
**After**: ~480 lines (+100 lines of fallback logic and diagnostics)
