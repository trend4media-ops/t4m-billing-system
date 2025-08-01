# Nixpacks Deployment Fixes

## Problem
Nixpacks was unable to generate a build plan, failing with "npm ci" exit code 1 during cloud deployment.

## Root Causes
1. Nixpacks couldn't detect the project as a valid Node.js application
2. Monorepo structure (root + backend subdirectory) confused the build system  
3. npm was trying to perform audits/fund checks during builds, causing network timeouts
4. Missing npm configuration for cloud build optimization

## Solutions Applied

### 1. Root Project Structure ✅
- Added `dependencies: {}` and `devDependencies: {}` to root `package.json`
- Created `.nvmrc` with Node.js 18 specification
- Generated `package-lock.json` at root level via `npm install`

### 2. Nixpacks Configuration ✅
Updated `nixpacks.toml`:
```toml
[variables]
NODE_ENV = "production"
NPM_CONFIG_FUND = "false"
NPM_CONFIG_AUDIT = "false"

[phases.install]
dependsOn = ["setup"]
cmds = [
  "cd trend4media-backend",
  "npm config set progress false",
  "npm config set fund false", 
  "npm config set audit false",
  "npm ci --no-audit --no-fund --prefer-offline --production=false"
]
```

### 3. NPM Optimization ✅
Created `trend4media-backend/.npmrc`:
```
progress=false
fund=false
audit=false
prefer-offline=true
engine-strict=true
save-exact=true
```

### 4. Railway Configuration ✅
Updated `railway.toml`:
```toml
[variables]
NODE_ENV = "production"
NPM_CONFIG_FUND = "false"
NPM_CONFIG_AUDIT = "false"
NPM_CONFIG_PROGRESS = "false"
```

### 5. Docker Optimization ✅
Added comprehensive `.dockerignore` to exclude:
- node_modules (except when needed)
- Development files (.vscode, .idea, etc.)
- Documentation and test files
- Temporary and cache directories

## Testing Locally
Run the build test script:
```bash
./test-build.sh
```

## Deployment Process
1. Commit all changes
2. Push to main branch: `git push origin main`
3. Railway will automatically trigger a new build
4. Monitor deployment logs for success

## Future Prevention
- Keep `.npmrc` optimization settings
- Maintain structured `nixpacks.toml` with phase dependencies
- Use `--no-audit --no-fund` flags for all cloud npm commands
- Test builds locally with `./test-build.sh` before deploying

## Key Learnings
- Cloud build environments need explicit npm configuration
- Monorepo structures require careful Nixpacks setup
- Network overhead during builds can cause timeouts
- Prefer offline/cached packages when possible in cloud builds 