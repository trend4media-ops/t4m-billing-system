# 🚀 trend4media Abrechnungssystem

Vollständiges Backend und Frontend System für das trend4media Abrechnungssystem mit NestJS + Next.js.

## 📋 System Übersicht

- **Backend**: NestJS 11 mit TypeScript, PostgreSQL, JWT Authentication
- **Frontend**: Next.js 14 mit TypeScript, Tailwind CSS, React Context
- **Deployment**: Docker + GitHub Actions CI/CD
- **Cloud**: Heroku (Backend) + Vercel/Firebase (Frontend)

---

## 🌐 Production URLs

### 🎯 Custom Domains (Primary)
- **Frontend**: `https://app.trend4media.com`
- **Backend**: `https://api.trend4media.com`

### 📊 Main Application URLs
- **Login**: `https://app.trend4media.com/login`
- **Admin Panel**: `https://app.trend4media.com/admin`
- **Manager Dashboard**: `https://app.trend4media.com/dashboard`
- **API Health**: `https://api.trend4media.com/auth/health`
- **API Documentation**: `https://api.trend4media.com/api/docs`

### 🔄 Alternative Frontend Deployments
```
Vercel:   https://trend4media-frontend.vercel.app
Firebase: https://trend4media-frontend.web.app
Legacy:   https://trend4media-backend-prod.herokuapp.com
```

---

## 🌐 Custom Domain Setup

Für die Einrichtung der Custom Domains `app.trend4media.com` und `api.trend4media.com`:

**📖 Vollständige Anleitung:** → [`CUSTOM_DOMAIN_SETUP.md`](./CUSTOM_DOMAIN_SETUP.md)

### Quick Setup Steps:
1. **Vercel**: Domain `app.trend4media.com` hinzufügen → CNAME Record kopieren
2. **Heroku**: Domain `api.trend4media.com` hinzufügen → DNS Target kopieren  
3. **DNS Provider**: CNAME Records konfigurieren
4. **Environment Variables**: `NEXT_PUBLIC_API_URL=https://api.trend4media.com`
5. **Testing**: DNS Propagation + SSL Certificates prüfen

---

## 🔥 Firebase Hosting Deployment

Alternative Frontend-Deployment zu Vercel mit statischen Exporten:

**📖 Vollständige Anleitung:** → [`FIREBASE_DEPLOYMENT.md`](./FIREBASE_DEPLOYMENT.md)

### Quick Firebase Setup:
```bash
cd trend4media-frontend

# Static Export Build
NEXT_PUBLIC_API_URL=https://api.trend4media.com npm run export

# Firebase CLI Login
firebase login:ci --token "$FIREBASE_TOKEN"

# Deployment
firebase deploy --only hosting --project trend4media-frontend

# Result: https://trend4media-frontend.web.app
```

---

## 🔐 Login Credentials

### Administrator
```
Email: admin@trend4media.com
Password: AdminPassword123!
→ Redirect: /admin
```

### Manager (Test User)
```
Email: manager@trend4media.com
Password: ManagerPassword123!
→ Redirect: /dashboard
```

---

## 🛠️ Local Development

### Prerequisites
```bash
# Required
- Node.js 18+
- PostgreSQL 15+
- Docker & Docker Compose (optional)
```

### Backend Setup
```bash
# Clone and setup
git clone <repository>
cd trend4media-backend

# Install dependencies
npm install

# Environment variables
cp .env.example .env
# Configure database connection

# Database migration & seeding
npm run migration:run
npm run db:seed

# Start development server
npm run start:dev
# → http://localhost:3000
```

### Frontend Setup
```bash
# Frontend directory
cd trend4media-frontend

# Install dependencies
npm install

# Environment variables
cp .env.example .env.local
# Set NEXT_PUBLIC_API_URL=http://localhost:3000

# Start development server
npm run dev
# → http://localhost:3001
```

### Docker Development
```bash
# Full stack with Docker Compose
docker-compose up -d

# Services:
# - Backend: http://localhost:3000
# - Frontend: http://localhost:3001
# - PostgreSQL: localhost:5432
# - Redis: localhost:6379
```

---

## 🚀 Deployment Guide

### Backend Deployment (Heroku)

1. **Create Heroku App**
   ```bash
   heroku create trend4media-backend-prod
   heroku addons:create heroku-postgresql:standard-0
   ```

2. **GitHub Secrets** (Repository Settings → Secrets)
   ```
   HEROKU_API_KEY=your-heroku-api-key
   HEROKU_APP_NAME=trend4media-backend-prod
   HEROKU_EMAIL=your-email@example.com
   JWT_SECRET=32-character-minimum-secret
   ADMIN_EMAIL=admin@trend4media.com
   ADMIN_PASSWORD=SecurePassword123!
   ```

3. **Custom Domain Setup**
   ```bash
   # Add custom domain in Heroku
   # Configure DNS CNAME record
   # See: CUSTOM_DOMAIN_SETUP.md
   ```

### Frontend Deployment (Multiple Options)

#### Option A: Vercel (Recommended)
1. **Connect Repository**
   - Import GitHub repository to Vercel
   - Framework: Next.js
   - Root Directory: `trend4media-frontend`

2. **Environment Variables**
   ```
   NEXT_PUBLIC_API_URL=https://api.trend4media.com
   ```

3. **Custom Domain Setup**
   ```bash
   # Add custom domain in Vercel
   # Configure DNS CNAME record
   # See: CUSTOM_DOMAIN_SETUP.md
   ```

#### Option B: Firebase Hosting
1. **Firebase Project Setup**
   ```bash
   # Firebase Console: Create project "trend4media-frontend"
   firebase login:ci  # Generate CI token
   ```

2. **Build & Deploy**
   ```bash
   cd trend4media-frontend
   NEXT_PUBLIC_API_URL=https://api.trend4media.com npm run export
   firebase deploy --only hosting --project trend4media-frontend
   ```

3. **Result URLs**
   ```
   Primary:  https://trend4media-frontend.web.app
   Legacy:   https://trend4media-frontend.firebaseapp.com
   ```

---

## 🔍 API Testing

### Health Check
```bash
curl https://api.trend4media.com/auth/health
```

### Authentication
```bash
# Admin Login
curl -X POST https://api.trend4media.com/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@trend4media.com","password":"AdminPassword123!"}'
```

### Swagger Documentation
```
https://api.trend4media.com/api/docs
```

---

## 📊 Features

### Backend Features
- ✅ JWT Authentication with Role-based Access Control
- ✅ PostgreSQL Database with TypeORM
- ✅ RESTful API with Swagger Documentation
- ✅ File Upload for Excel Processing
- ✅ Commission Calculation Engine
- ✅ Genealogy Management System
- ✅ Health Check Endpoints
- ✅ Docker Support
- ✅ CI/CD with GitHub Actions
- ✅ Custom Domain Support

### Frontend Features
- ✅ Modern React/Next.js 14 App Router
- ✅ TypeScript + Tailwind CSS
- ✅ Responsive Design (Mobile-First)
- ✅ Protected Routes with Role-based Access
- ✅ Form Validation with Zod + React Hook Form
- ✅ API Integration with Axios
- ✅ Loading States & Error Handling
- ✅ trend4media Branding (#ED0C81)
- ✅ Custom Domain Support
- ✅ Static Export für Firebase Hosting

---

## 🧪 Testing

### Backend Tests
```bash
# Unit Tests
npm run test

# E2E Tests
npm run test:e2e

# Coverage Report
npm run test:cov
```

### Frontend Tests
```bash
# Component Tests
npm run test

# Coverage Report
npm run test:coverage
```

---

## 📈 Architecture

### Backend Structure
```
src/
├── auth/           # Authentication (JWT, Guards, Strategies)
├── users/          # User Management
├── managers/       # Manager-specific Logic
├── creators/       # Creator Management
├── commissions/    # Commission Calculations
├── genealogy/      # Team Structure Management
├── uploads/        # File Upload Processing
├── bonuses/        # Bonus Calculations
└── database/       # Database Configuration & Seeds
```

### Frontend Structure
```
src/
├── app/            # Next.js App Router Pages
│   ├── login/      # Authentication
│   ├── admin/      # Admin Panel
│   └── dashboard/  # Manager Dashboard
├── components/     # Reusable Components
│   ├── ui/         # UI Components
│   └── charts/     # Data Visualization
├── contexts/       # React Context (Auth)
└── lib/            # API Client & Utilities
```

---

## 🔧 CI/CD Pipeline

### Backend Pipeline
```yaml
Trigger: Push to main branch
Steps:
  1. Run Tests (Jest + PostgreSQL)
  2. TypeScript Type Check
  3. ESLint Code Quality
  4. Docker Build & Push
  5. Heroku Deployment
  6. Custom Domain Health Check
  7. SSL Certificate Verification
```

### Frontend Pipeline

#### Vercel (Automatic)
```yaml
Trigger: Any push to repository
Steps:
  1. Vercel Auto-Build
  2. TypeScript Check
  3. Next.js Optimization
  4. Custom Domain Deployment
  5. HTTPS Enforcement
```

#### Firebase (GitHub Actions)
```yaml
Trigger: Push to trend4media-frontend/
Steps:
  1. Static Export Build
  2. Firebase CLI Deploy
  3. Performance & SSL Check
  4. CDN Cache Purge
```

---

## 📋 Production Checklist

### ✅ Completed
- [x] Backend API with all endpoints
- [x] Frontend with responsive design
- [x] Authentication & authorization
- [x] Database schema & migrations
- [x] Docker containerization
- [x] CI/CD pipelines
- [x] Health check monitoring
- [x] Production deployment
- [x] SSL/HTTPS enforcement
- [x] Environment variable configuration
- [x] API documentation (Swagger)
- [x] Error handling & logging
- [x] Custom domain configuration
- [x] DNS & SSL certificate setup
- [x] Firebase Hosting support

### 🎯 Ready for Features
- [ ] Manager earnings dashboard
- [ ] Excel upload processing
- [ ] Genealogy visualization
- [ ] Bonus calculation interface
- [ ] Reporting dashboard
- [ ] User management UI

---

## 🆘 Support & Troubleshooting

### Backend Issues
```bash
# Check logs
heroku logs --tail -a trend4media-backend-prod

# Restart application
heroku restart -a trend4media-backend-prod

# Database check
heroku pg:info -a trend4media-backend-prod

# Custom domain check
heroku domains -a trend4media-backend-prod
```

### Frontend Issues

#### Vercel
```bash
# Redeploy
vercel --prod

# Check build logs
vercel logs app.trend4media.com

# Domain status
vercel domains ls
```

#### Firebase
```bash
# Redeploy
firebase deploy --only hosting

# Project status
firebase projects:list

# Hosting logs
firebase hosting:logs --project trend4media-frontend
```

### Custom Domain Issues
```bash
# DNS Propagation Check
nslookup app.trend4media.com
nslookup api.trend4media.com

# SSL Certificate Check
curl -I https://app.trend4media.com
curl -I https://api.trend4media.com

# See: CUSTOM_DOMAIN_SETUP.md für detailliertes Troubleshooting
```

---

## 📊 Deployment Options Comparison

| Feature | Vercel | Firebase | Backend |
|---------|---------|----------|---------|
| **Setup** | Automatic | Manual | Docker |
| **Build Time** | Fastest | Fast | Medium |
| **Custom Domains** | ✅ Easy | ✅ Good | ✅ Good |
| **SSL** | ✅ Auto | ✅ Auto | ✅ Auto |
| **CDN** | ✅ Global | ✅ Global | ❌ |
| **Free Tier** | Limited | Generous | Paid |
| **Performance** | 95+ | 90+ | N/A |

### Recommended Strategy:
- **Development**: Vercel (fastest setup)
- **Staging**: Firebase (testing)
- **Production**: Custom Domains (professional)

---

**Status: ✅ Production Ready with Multi-Platform Support**

Primary URLs:  
🌐 **Frontend**: https://app.trend4media.com  
🔧 **Backend**: https://api.trend4media.com  

Alternative URLs:  
🔗 **Vercel**: https://trend4media-frontend.vercel.app  
🔥 **Firebase**: https://trend4media-frontend.web.app  

**Login getestet ✅** | **API dokumentiert ✅** | **CI/CD aktiv ✅** | **Custom Domains ✅** | **Firebase Support ✅** 