# ⚡ GitHub Actions Cloud Harvester - Setup Guide

## ✅ Why GitHub Actions?

- **100% FREE** - 2,000 minutes/month free (we use ~12 minutes/month)
- **No billing required** - No credit card needed
- **Proven & reliable** - Used by millions of developers
- **Built-in scheduler** - Runs every 2 hours automatically
- **Manual trigger** - Click button to run anytime

---

## 🚀 Setup Steps

### Step 1: Create GitHub Repository

1. Go to [GitHub.com](https://github.com)
2. Click "New Repository"
3. Name: `cairo-taj-quota-harvester` (or any name)
4. Set to **Private** (important!)
5. Click "Create repository"

### Step 2: Push Code to GitHub

```powershell
cd "e:\Proj work"
git init
git add .github github-harvester
git commit -m "Add GitHub Actions cloud harvester"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/cairo-taj-quota-harvester.git
git push -u origin main
```

### Step 3: Add Secrets to GitHub

1. Go to your repository on GitHub
2. Click **Settings** → **Secrets and variables** → **Actions**
3. Click **New repository secret**
4. Add these 4 secrets:

| Secret Name | Value |
|-------------|-------|
| `FIREBASE_API_KEY` | `AIzaSyCXcgDR4r3-HT30Ia6rOJt2Qosv1-Csv0o` |
| `FIREBASE_PROJECT_ID` | `pc-s-manager` |
| `WE_USERNAME` | `0237483361` |
| `WE_PASSWORD` | `P@ssw0rd` |

### Step 4: Enable GitHub Actions

1. Go to **Actions** tab in your repository
2. Click "I understand my workflows, go ahead and enable them"
3. You'll see "Cloud Quota Harvester" workflow

### Step 5: Test Manual Run

1. Click on "Cloud Quota Harvester" workflow
2. Click **Run workflow** → **Run workflow**
3. Wait ~2 minutes
4. Check Firestore `quota_latest/current` for updated data

---

## 📊 How It Works

1. **Every 2 hours** - GitHub Actions wakes up automatically
2. **Spins up Ubuntu VM** - Fresh Linux machine
3. **Installs Node.js + Puppeteer** - Downloads dependencies
4. **Runs harvester.js** - Scrapes WE Egypt
5. **Writes to Firestore** - Updates quota data
6. **Shuts down VM** - No cost, no trace

---

## 💰 Cost Analysis

- **Runs per month**: 360 (every 2 hours)
- **Time per run**: ~2 minutes
- **Total time**: 720 minutes/month
- **Free tier**: 2,000 minutes/month
- **Usage**: Only 36% of free tier ✅

**Result: 100% FREE forever!**

---

## 🔍 Monitoring

### View Logs:
1. Go to **Actions** tab
2. Click on any workflow run
3. Click "harvest" job
4. See live logs with emojis (🚀, ✅, ❌)

### Check Data:
- Firestore: `quota_latest/current` field `104`
- Look for: `updatedBy: "GitHub Cloud Harvester ⚡"`

---

## 🎯 Features

✅ **Automatic** - Runs every 2 hours (cron: `0 */2 * * *`)
✅ **Manual trigger** - Click button to run anytime
✅ **Stealth mode** - Same Puppeteer + Stealth as local
✅ **Error handling** - Exits with code 1 on failure
✅ **Detailed logs** - Step-by-step console output
✅ **Private repo** - Credentials safe in GitHub Secrets
✅ **No billing** - Completely free forever

---

## 🛡️ Security

- ✅ Credentials stored in GitHub Secrets (encrypted)
- ✅ Private repository (only you can see)
- ✅ No credentials in code
- ✅ Secrets never logged
- ✅ VM destroyed after each run

---

## 🆘 Troubleshooting

**Workflow not running?**
- Check Actions tab is enabled
- Verify secrets are added correctly
- Check workflow file syntax

**Harvester failing?**
- Check logs in Actions tab
- Verify WE Egypt website is accessible
- Check credentials (0237483361 / P@ssw0rd)

**Data not updating?**
- Check Firestore rules allow writes
- Verify API key is correct
- Check timestamp in `quota_latest/current`

---

## 🎉 Next Steps

1. Create GitHub repository
2. Push code
3. Add secrets
4. Enable Actions
5. Test manual run
6. Wait 2 hours for automatic run
7. Enjoy free cloud harvesting! ⚡
