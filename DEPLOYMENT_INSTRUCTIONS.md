# 🚀 T4M Billing System - Production Deployment Guide

## 🎯 **Quick Deployment (15 Minutes)**

### **Backend: Railway Deployment**

#### **1. Railway Setup**
1. **Gehe zu**: https://railway.app
2. **Anmelden** mit GitHub Account
3. **New Project** → **Deploy from GitHub repo**
4. **Repository wählen**: `trend4media-ops/t4m-billing-system`
5. **Root Directory**: `trend4media-backend`

#### **2. PostgreSQL hinzufügen**
1. **Add Service** → **Database** → **PostgreSQL**
2. Railway generiert automatisch `DATABASE_URL`

#### **3. Environment Variables setzen**
```env
# Railway Dashboard → Variables
NODE_ENV=production
JWT_SECRET=super-secure-jwt-secret-min-32-characters
FRONTEND_URL=https://YOUR-FRONTEND-URL.vercel.app
PORT=3000
# DATABASE_URL wird automatisch gesetzt
```

#### **4. Custom Domain (Optional)**
- **Settings** → **Domains** → **Custom Domain**: `api.trend4media.com`

---

### **Frontend: Vercel Deployment**

#### **1. Vercel Setup**
1. **Gehe zu**: https://vercel.com
2. **Anmelden** mit GitHub Account
3. **Add New** → **Project**
4. **Import** → `trend4media-ops/t4m-billing-system`
5. **Root Directory**: `trend4media-frontend`

#### **2. Environment Variables**
```env
# Vercel Dashboard → Settings → Environment Variables
NEXT_PUBLIC_API_URL=https://YOUR-RAILWAY-BACKEND.up.railway.app
```

#### **3. Build & Deploy Settings**
- **Framework Preset**: Next.js
- **Build Command**: `npm run build`
- **Output Directory**: `.next`
- **Install Command**: `npm ci`

#### **4. Custom Domain (Optional)**
- **Settings** → **Domains**: `app.trend4media.com`

---

## 🔧 **Detailed Setup Steps**

### **Railway Backend Deployment**

```bash
# 1. GitHub Repository ist bereits eingerichtet ✅
# 2. Railway.json ist konfiguriert ✅

# 3. Gehe zu Railway Dashboard:
# https://railway.app/new

# 4. Deploy from GitHub repo
# - Repository: trend4media-ops/t4m-billing-system
# - Root Directory: trend4media-backend
# - Auto-Deploy: main branch
```

**Railway Environment Variables:**
```env
NODE_ENV=production
JWT_SECRET=your-super-secure-jwt-secret-minimum-32-characters-long
FRONTEND_URL=https://t4m-billing-frontend.vercel.app
PORT=3000
# DATABASE_URL=postgresql://... (automatisch gesetzt)
```

### **Vercel Frontend Deployment**

```bash
# 1. Gehe zu Vercel Dashboard:
# https://vercel.com/new

# 2. Import Git Repository
# - Repository: trend4media-ops/t4m-billing-system
# - Root Directory: trend4media-frontend
# - Framework: Next.js (auto-detected)
```

**Vercel Environment Variables:**
```env
NEXT_PUBLIC_API_URL=https://your-backend-name.up.railway.app
```

---

## 🚦 **Post-Deployment Checklist**

### **✅ Backend Health Check**
```bash
curl https://your-backend.up.railway.app/health
# Expected: {"status":"ok","info":{"database":{"status":"up"}}}
```

### **✅ Frontend Access**
- Login Page: `https://your-frontend.vercel.app/login`
- Admin Panel: `https://your-frontend.vercel.app/admin`
- Dashboard: `https://your-frontend.vercel.app/dashboard`

### **✅ API Documentation**
- Swagger UI: `https://your-backend.up.railway.app/api`

### **✅ Database Setup**
```bash
# Railway führt automatisch Migrations aus via TypeORM
# Falls nötig, Manual Seed:
# Railway Dashboard → Deploy Logs → Manual Commands
npm run seed:staging
```

---

## 🌐 **Custom Domains Setup**

### **Backend (api.trend4media.com)**
1. **Railway** → **Settings** → **Domains**
2. **Custom Domain**: `api.trend4media.com`
3. **DNS**: CNAME → Railway Endpoint

### **Frontend (app.trend4media.com)**
1. **Vercel** → **Settings** → **Domains**
2. **Add Domain**: `app.trend4media.com`
3. **DNS**: CNAME → Vercel

---

## 🔒 **Production Security**

### **Environment Secrets**
```env
# NIEMALS in Code committen!
JWT_SECRET=zufalliger-32-zeichen-string
DATABASE_URL=postgresql://encrypted-connection
API_KEYS=production-api-keys
```

### **CORS Configuration**
```javascript
// Backend automatisch konfiguriert für:
origin: process.env.FRONTEND_URL
credentials: true
```

---

## 📊 **Monitoring & Logs**

### **Railway Monitoring**
- **Metrics**: CPU, Memory, Response Times
- **Logs**: Real-time Application Logs
- **Alerts**: Email/Slack bei Problemen

### **Vercel Analytics**
- **Performance**: Core Web Vitals
- **Functions**: Serverless Function Metrics
- **Deployments**: Build Status & History

---

## 🚀 **Go-Live URLs**

Nach erfolgreichem Deployment:

**🎯 Production URLs:**
- **Frontend**: `https://t4m-billing-frontend.vercel.app`
- **Backend API**: `https://t4m-billing-backend.up.railway.app`
- **Swagger Docs**: `https://t4m-billing-backend.up.railway.app/api`

**🎯 Mit Custom Domains:**
- **Frontend**: `https://app.trend4media.com`
- **Backend API**: `https://api.trend4media.com`

---

## ⚡ **Performance Optimierungen**

### **Frontend (Vercel)**
- ✅ **Static Site Generation** für bessere Performance
- ✅ **Image Optimization** automatisch
- ✅ **CDN** global verfügbar
- ✅ **Edge Functions** für API Routes

### **Backend (Railway)**
- ✅ **Auto-scaling** basierend auf Traffic
- ✅ **PostgreSQL** optimiert für Production
- ✅ **Health Checks** automatisch
- ✅ **Zero-downtime** Deployments

---

## 🆘 **Troubleshooting**

### **Häufige Probleme:**

1. **CORS Errors**
   - Frontend URL in Backend Environment Variable prüfen
   - `FRONTEND_URL=https://exact-frontend-url.vercel.app`

2. **Database Connection**
   - Railway PostgreSQL automatisch verbunden
   - DATABASE_URL automatisch gesetzt

3. **Environment Variables**
   - Alle Variablen in Railway/Vercel Dashboard setzen
   - Restart nach Änderungen

4. **Build Failures**
   - Node.js Version: 18+ (automatisch)
   - Dependencies: `npm ci` statt `npm install`

---

**🚀 Status: READY FOR PRODUCTION DEPLOYMENT**

*Geschätzte Setup-Zeit: 15-20 Minuten*
*Monatliche Kosten: $10-25 (Staging) | $25-75 (Production)* 