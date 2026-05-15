@echo off
echo ========================================
echo GitHub Actions Cloud Harvester Setup
echo ========================================
echo.
echo This will create a GitHub repository for cloud harvesting.
echo.
echo STEP 1: Create GitHub Repository
echo ---------------------------------
echo 1. Go to: https://github.com/new
echo 2. Repository name: cairo-taj-quota-harvester
echo 3. Set to PRIVATE
echo 4. Click "Create repository"
echo.
pause
echo.
echo STEP 2: Upload Files to GitHub
echo -------------------------------
echo 1. On the repository page, click "uploading an existing file"
echo 2. Drag these folders:
echo    - .github
echo    - github-harvester
echo 3. Commit message: "Add cloud harvester"
echo 4. Click "Commit changes"
echo.
pause
echo.
echo STEP 3: Add Secrets
echo -------------------
echo 1. Go to: Settings → Secrets and variables → Actions
echo 2. Click "New repository secret"
echo 3. Add these 4 secrets:
echo.
echo    Name: FIREBASE_API_KEY
echo    Value: AIzaSyCXcgDR4r3-HT30Ia6rOJt2Qosv1-Csv0o
echo.
echo    Name: FIREBASE_PROJECT_ID
echo    Value: pc-s-manager
echo.
echo    Name: WE_USERNAME
echo    Value: 0237483361
echo.
echo    Name: WE_PASSWORD
echo    Value: P@ssw0rd
echo.
pause
echo.
echo STEP 4: Enable Actions
echo ----------------------
echo 1. Go to: Actions tab
echo 2. Click "I understand my workflows, go ahead and enable them"
echo 3. Click "Cloud Quota Harvester"
echo 4. Click "Run workflow" → "Run workflow"
echo.
pause
echo.
echo STEP 5: Verify
echo --------------
echo 1. Wait 2 minutes for workflow to complete
echo 2. Check Firestore: quota_latest/current
echo 3. Look for: updatedBy: "GitHub Cloud Harvester ⚡"
echo.
echo ========================================
echo Setup Complete!
echo ========================================
pause
