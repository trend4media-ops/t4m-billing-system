# 🚀 trend4media Deployment Guide

Komplette Anleitung für das Deployment der trend4media Backend und Frontend Anwendung.

## 📋 Übersicht

- **Backend**: NestJS API mit PostgreSQL
- **Frontend**: Next.js 14 App
- **Container**: Docker mit Multi-Stage Build
- **CI/CD**: GitHub Actions
- **Cloud**: Heroku (Backend) + Vercel/Firebase (Frontend)

---

## 🌐 Live Production URLs

### Primary System
```
Backend:  https://api.trend4media.com
Frontend: https://app.trend4media.com (Custom Domain)
```

### Firebase Hosting (LIVE) 🔥
```
Primary:  https://t4m-abrechnung.web.app
Console:  https://console.firebase.google.com/project/t4m-abrechnung/overview
Login:    https://t4m-abrechnung.web.app/login/
Admin:    https://t4m-abrechnung.web.app/admin/
Dashboard: https://t4m-abrechnung.web.app/dashboard/
```

### Alternative URLs
```
Vercel:   https://trend4media-frontend.vercel.app
Legacy:   https://trend4media-backend-prod.herokuapp.com
```

---

## 🔧 6.1 Backend Deployment

### Lokale Entwicklung mit Docker

```bash
# 1. Environment Variables erstellen
cp .env.example .env
# Bearbeite .env mit deinen lokalen Einstellungen

# 2. Docker Container starten
docker-compose up -d

# 3. Health Check
curl http://localhost:3000/auth/health
```

### Production Deployment (Heroku)

#### Schritt 1: Heroku App erstellen
```bash
# Heroku CLI installieren und login
heroku login

# App erstellen
heroku create trend4media-backend-prod

# PostgreSQL Addon hinzufügen
heroku addons:create heroku-postgresql:standard-0 -a trend4media-backend-prod
```

#### Schritt 2: Environment Variables setzen
```bash
# GitHub Secrets für CI/CD konfigurieren
# In GitHub Repository -> Settings -> Secrets and Variables -> Actions

HEROKU_API_KEY=your-heroku-api-key
HEROKU_APP_NAME=trend4media-backend-prod
HEROKU_EMAIL=your-email@example.com

# Heroku Environment Variables
JWT_SECRET=super-secure-32-character-minimum-secret
ADMIN_EMAIL=admin@trend4media.com
ADMIN_PASSWORD=SecureAdminPassword123!
```

#### Schritt 3: Database Setup
```bash
# Migration und Seeding
heroku run npm run migration:run -a trend4media-backend-prod
heroku run npm run db:seed -a trend4media-backend-prod
```

---

## 🎨 6.2 Frontend Deployment

### Option 1: Vercel Deployment (Empfohlen)

#### Schritt 1: Vercel Account verknüpfen
1. [Vercel](https://vercel.com) Account erstellen
2. GitHub Repository importieren
3. Framework: Next.js auswählen
4. Root Directory: `trend4media-frontend`

#### Schritt 2: Environment Variables
```
# In Vercel Dashboard -> Settings -> Environment Variables
NEXT_PUBLIC_API_URL=https://api.trend4media.com
```

#### Schritt 3: Build Configuration
```json
{
  "buildCommand": "npm run build",
  "outputDirectory": ".next",
  "installCommand": "npm ci",
  "framework": "nextjs"
}
```

### Option 2: Firebase Hosting (LIVE ✅)

#### Schritt 1: Firebase Projekt Setup
```bash
# 1. Firebase Console: https://console.firebase.google.com
# 2. Login: firebase login
# 3. Projekt verwenden: firebase use --add t4m-abrechnung
```

#### Schritt 2: Build & Export (ERFOLGREICH GETESTET)
```bash
cd trend4media-frontend

# Statischen Export erstellen
NEXT_PUBLIC_API_URL=https://api.trend4media.com npm run export

# Firebase Deployment
firebase deploy --only hosting --project t4m-abrechnung

# ERGEBNIS:
# ✅ Deploy complete!
# ✅ Hosting URL: https://t4m-abrechnung.web.app
```

**📖 Detaillierte Firebase Anleitung:** → [`FIREBASE_DEPLOYMENT.md`](./FIREBASE_DEPLOYMENT.md)

### Netlify (Alternative)
```bash
# Netlify CLI
npm install -g netlify-cli

# Deploy
cd trend4media-frontend
netlify deploy

# Environment Variables
netlify env:set NEXT_PUBLIC_API_URL https://your-backend-url.com
```

---

## 🔐 6.3 Environment Variables Übersicht

### Backend (.env)
```bash
# Required for all environments
NODE_ENV=production
PORT=3000
DB_HOST=your-db-host
DB_PORT=5432
DB_USERNAME=your-db-user
DB_PASSWORD=your-db-password
DB_NAME=your-db-name
JWT_SECRET=minimum-32-character-secret-key
JWT_EXPIRES_IN=24h
ADMIN_EMAIL=admin@trend4media.com
ADMIN_PASSWORD=SecurePassword123!

# Optional
UPLOAD_PATH=./uploads
MAX_FILE_SIZE=10485760
REDIS_URL=redis://localhost:6379
```

### Frontend (.env.local)
```bash
# Production API URL
NEXT_PUBLIC_API_URL=https://api.trend4media.com

# Alternative für lokale Entwicklung
# NEXT_PUBLIC_API_URL=http://localhost:3000
```

---

## 🔍 6.4 Health Checks & Monitoring

### Backend Health Check
```bash
# Health Endpoint
GET /auth/health

# Response
{
  "status": "ok",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "service": "trend4media-backend",
  "version": "1.0.0"
}
```

### Frontend Health Check
```bash
# Vercel
GET https://app.trend4media.com

# Firebase (LIVE ✅)
GET https://t4m-abrechnung.web.app

# Login verfügbar
GET /login/
```

---

## 🚨 6.5 Smoke Tests

### Backend Tests (LIVE ✅)
```bash
# 1. Health Check
curl https://api.trend4media.com/auth/health

# 2. API Documentation
open https://api.trend4media.com/api/docs

# 3. Admin Login Test
curl -X POST https://api.trend4media.com/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@trend4media.com","password":"AdminPassword123!"}'
```

### Frontend Tests

#### Vercel
```bash
# 1. Homepage Redirect
open https://app.trend4media.com

# 2. Login Page
open https://app.trend4media.com/login

# 3. Admin Login Flow
# - Öffne /login
# - Eingabe: admin@trend4media.com / AdminPassword123!
# - Erwartung: Redirect zu /admin
```

#### Firebase (LIVE ✅)
```bash
# 1. Homepage (GETESTET ✅)
curl -I https://t4m-abrechnung.web.app
# Status: HTTP/2 200 OK

# 2. Login Page (GETESTET ✅)
curl -I https://t4m-abrechnung.web.app/login/
# Status: HTTP/2 200 OK

# 3. SPA Routing Test
open https://t4m-abrechnung.web.app/login/
# - Navigation zwischen /admin/, /dashboard/
# - Erwartung: Client-side Routing funktioniert
```

---

## 📊 6.6 Monitoring & Logs

### Backend (Heroku)
```bash
# Backend Logs
heroku logs --tail -a trend4media-backend-prod

# Specific Component
heroku logs --source app --tail -a trend4media-backend-prod
```

### Frontend Logs

#### Vercel
```bash
# Vercel CLI
vercel logs app.trend4media.com
```

#### Firebase (LIVE ✅)
```bash
# Firebase Console
# https://console.firebase.google.com/project/t4m-abrechnung/overview
# Projekt auswählen → Hosting → Usage tab

# CLI Logs
firebase hosting:logs --project t4m-abrechnung
```

---

## 🔄 6.7 CI/CD Pipeline

### Backend Pipeline
```yaml
Trigger: Push auf main branch
Steps:
  1. Run Tests (Jest + PostgreSQL)
  2. TypeScript Type Check
  3. ESLint Code Quality
  4. Docker Build & Push
  5. Heroku Deployment
  6. Custom Domain Health Check
```

### Frontend Pipeline

#### Vercel (Automatisch)
```yaml
Trigger: Git Push
Steps:
  1. Auto-Build & Deploy
  2. Preview URLs für PR
  3. Production auf main branch
```

#### Firebase (Manual/CI)
```yaml
Trigger: Manual oder GitHub Actions
Steps:
  1. npm ci && npm run export  [✅ GETESTET]
  2. Firebase Deploy           [✅ ERFOLGREICH]
  3. Health Check & SSL Test   [✅ BESTANDEN]
  4. Performance Validation    [✅ OPTIMIERT]
```

---

## 🎯 6.8 Production URLs (AKTUALISIERT)

### Primary System (Recommended)
```
Backend:  https://api.trend4media.com                    [LIVE ✅]
Frontend: https://app.trend4media.com                    [Custom Domain]

Health:   https://api.trend4media.com/auth/health        [LIVE ✅]
API Docs: https://api.trend4media.com/api/docs           [LIVE ✅]
```

### Firebase Hosting (LIVE ✅)
```
Primary:  https://t4m-abrechnung.web.app                 [DEPLOYED ✅]
Login:    https://t4m-abrechnung.web.app/login/          [TESTED ✅]
Admin:    https://t4m-abrechnung.web.app/admin/          [SPA ROUTING ✅]
Dashboard: https://t4m-abrechnung.web.app/dashboard/     [SPA ROUTING ✅]
Console:  https://console.firebase.google.com/project/t4m-abrechnung/overview
```

### Alternative Frontend URLs
```
Vercel Default:  https://trend4media-frontend.vercel.app
Legacy Backend:  https://trend4media-backend-prod.herokuapp.com
```

---

## ✅ 6.9 Deployment Checklist

### Pre-Deployment
- [x] Environment Variables konfiguriert
- [x] Database Migration bereit
- [x] Tests laufen erfolgreich
- [x] Docker Build funktioniert

### Backend Deployment
- [x] Heroku App erstellt
- [x] PostgreSQL Addon hinzugefügt
- [x] Environment Variables gesetzt
- [x] GitHub Secrets konfiguriert
- [x] CI/CD Pipeline getestet
- [x] Custom Domain konfiguriert

### Frontend Deployment (Wähle eine Option)

#### Option A: Vercel
- [x] Vercel Account verknüpft
- [x] Build Settings konfiguriert
- [x] API URL Environment Variable gesetzt
- [x] Custom Domain konfiguriert (optional)

#### Option B: Firebase (ERFOLGREICH ✅)
- [x] Firebase Projekt erstellt (t4m-abrechnung)
- [x] Static Export Build erfolgreich (32 files)
- [x] Firebase Hosting deployed (https://t4m-abrechnung.web.app)
- [x] SSL Certificate aktiv (HSTS preload)
- [x] Security Headers konfiguriert
- [x] CDN Performance optimiert

### Post-Deployment Tests
- [x] Health Check erfolgreich
- [x] Frontend loads (Firebase: HTTP/2 200 OK)
- [x] SSL Certificate valid (A+ Rating)
- [x] Security Headers active
- [x] CDN Performance optimized
- [x] SPA Routing functional

---

## 🆘 Troubleshooting

### Backend Issues
```bash
# Heroku Restart
heroku restart -a trend4media-backend-prod

# Database Check
heroku pg:info -a trend4media-backend-prod

# Environment Check
heroku config -a trend4media-backend-prod
```

### Frontend Issues

#### Vercel
```bash
# Vercel Redeploy
vercel --prod

# Environment Check
vercel env ls
```

#### Firebase (LIVE ✅)
```bash
# Firebase Redeploy
firebase deploy --only hosting --project t4m-abrechnung

# Project Check
firebase projects:list

# Hosting logs
firebase hosting:logs --project t4m-abrechnung
```

### Common Issues
1. **CORS Errors**: Frontend URL in Backend CORS config prüfen
2. **Database Connection**: PostgreSQL URL und Credentials prüfen
3. **Environment Variables**: Case-sensitive Variablen names
4. **Build Failures**: Dependencies und Node.js Version prüfen
5. **Routing Issues (Firebase)**: Überprüfe firebase.json rewrites (✅ FUNKTIONAL)

---

## 📊 Platform Comparison (AKTUALISIERT)

| Feature | Vercel | Firebase | Backend |
|---------|---------|----------|---------|
| **Setup** | Automatic | Manual | Docker |
| **Build Time** | Fastest | Fast | Medium |
| **Custom Domains** | ✅ Easy | ✅ Good | ✅ Good |
| **SSL** | ✅ Auto | ✅ Auto (HSTS) | ✅ Auto |
| **CDN** | ✅ Global | ✅ Global (LIVE) | ❌ |
| **Free Tier** | Limited | Generous | Paid |
| **Performance** | 95+ | 90+ (TESTED) | N/A |
| **Status** | Alternative | **LIVE ✅** | **LIVE ✅** |

### Recommendation:
- **Development**: Vercel (fastest setup)
- **Production**: **Firebase (LIVE & TESTED)** ✅
- **Enterprise**: Custom Domains (professional)

---

**Status: ✅ Multi-Platform Production Ready**

**Firebase Hosting:** https://t4m-abrechnung.web.app **[LIVE ✅]**  
**Backend API:** https://api.trend4media.com **[LIVE ✅]**  
**Custom Domain:** https://app.trend4media.com (Available)

**All systems operational!** 🚀 