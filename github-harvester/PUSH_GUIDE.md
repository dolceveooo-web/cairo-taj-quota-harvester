# Quick Push Guide

## Using GitHub Desktop (Recommended)
1. Open GitHub Desktop
2. Select repository: `cairo-taj-quota-harvester`
3. You should see changes in `github-harvester/harvester.js`
4. Commit message: `ULTIMATE FIX: 6 dropdown methods + extended timeouts + diagnostics`
5. Click "Commit to main"
6. Click "Push origin"

## Using Git Command Line (if available)
```bash
cd "e:\Proj work"
git add github-harvester/harvester.js
git add github-harvester/FIXES_APPLIED.md
git add github-harvester/PUSH_GUIDE.md
git commit -m "ULTIMATE FIX: 6 dropdown methods + extended timeouts + diagnostics"
git push origin main
```

## Using VS Code
1. Open VS Code
2. Open Source Control panel (Ctrl+Shift+G)
3. Stage changes (+ icon next to files)
4. Enter commit message: `ULTIMATE FIX: 6 dropdown methods + extended timeouts + diagnostics`
5. Click ✓ Commit
6. Click "Sync Changes" or "Push"

## After Pushing
1. Go to: https://github.com/YOUR_USERNAME/cairo-taj-quota-harvester
2. Click "Actions" tab
3. Click "Cloud Harvester" workflow
4. Click "Run workflow" button (right side)
5. Click green "Run workflow" button
6. Watch the logs in real-time

## What to Look For in Logs
✅ **Success indicators**:
- "✓ Method X succeeded" for dropdown (should be 1-6)
- "Dropdown value: Internet" or similar
- "✓ Login successful"
- "✅ SUCCESS"

❌ **If still fails**:
- Check which dropdown method got furthest
- Look for "Page state:" JSON output
- Check "Screenshot captured" line
- Share the full log output

## Key Improvements Made
- **6 dropdown methods** (was 3)
- **25-35 second timeouts** (was 15-20)
- **Screenshot capture** on failure
- **Page state diagnostics** (URL, dropdown value, field values)
- **Network idle wait** strategy added
- **Dropdown verification** before password input
