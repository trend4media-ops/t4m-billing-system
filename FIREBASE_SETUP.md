# 🔥 Firebase Setup Guide - T4M Billing System

## 🎯 Why Firebase?

✅ **No more Docker build errors!**  
✅ **No more complex deployment configurations**  
✅ **Automatic scaling and reliability**  
✅ **Integrated authentication and database**  
✅ **Simple deployment with one command**

---

## 🚀 Quick Setup (10 Minutes)

### 1. **Firebase Project Setup**

```bash
# Install Firebase CLI (if not already installed)
npm install -g firebase-tools

# Login to Firebase
firebase login

# Create new project (or use existing)
firebase projects:create trend4media-billing
```

### 2. **Initialize Firebase in your project**

```bash
# Initialize Firebase (skip if already done)
firebase init

# Select:
# ✅ Firestore: Configure security rules and indexes files
# ✅ Functions: Configure and deploy Cloud Functions
# ✅ Hosting: Configure files for Firebase Hosting
```

### 3. **Deploy Everything**

```bash
# One command deployment! 🚀
./deploy-firebase.sh
```

---

## 📁 New Project Structure

```
T4M WEB APP/
├── firebase.json              # Firebase configuration
├── firestore.rules           # Database security rules
├── firestore.indexes.json    # Database indexes
├── functions/                 # Backend API (Cloud Functions)
│   ├── index.js              # Main API endpoints
│   ├── package.json          # Backend dependencies
│   └── tsconfig.json         # TypeScript config
├── trend4media-frontend/     # React frontend
└── deploy-firebase.sh        # One-click deployment
```

---

## 🔧 Configuration

### Environment Variables

Create `trend4media-frontend/.env.local`:

```env
# Get these from Firebase Console > Project Settings
FIREBASE_PROJECT_ID=trend4media-billing
FIREBASE_API_KEY=your-api-key
FIREBASE_AUTH_DOMAIN=trend4media-billing.firebaseapp.com
FIREBASE_STORAGE_BUCKET=trend4media-billing.appspot.com
FIREBASE_MESSAGING_SENDER_ID=123456789
FIREBASE_APP_ID=1:123456789:web:abc123

# API endpoint (automatically configured)
NEXT_PUBLIC_API_URL=https://europe-west1-trend4media-billing.cloudfunctions.net/api
```

---

## 🛠️ Development Commands

```bash
# Local development with Firebase Emulators
firebase emulators:start

# Deploy only functions
firebase deploy --only functions

# Deploy only frontend
firebase deploy --only hosting

# View function logs
firebase functions:log

# Frontend development (in trend4media-frontend/)
npm run dev
```

---

## 🗄️ Database Migration

### From PostgreSQL to Firestore

The system now uses **Firestore** instead of PostgreSQL:

**Benefits:**
- ✅ No database setup required
- ✅ Automatic scaling
- ✅ Real-time updates
- ✅ Built-in security rules
- ✅ No SQL injection risks

**Collections:**
- `users` - User accounts and roles
- `managers` - Manager profiles
- `creators` - Creator profiles  
- `transactions` - Financial transactions
- `bonuses` - Bonus calculations
- `audit-logs` - System audit trail

---

## 🔐 Authentication

Now uses **Firebase Authentication**:

- ✅ Built-in email/password auth
- ✅ JWT tokens handled automatically
- ✅ Role-based access control
- ✅ Password reset functionality
- ✅ Account management UI

---

## 📊 API Endpoints

Base URL: `https://europe-west1-YOUR-PROJECT.cloudfunctions.net/api`

### Authentication
- `POST /auth/login` - User login

### Managers
- `GET /managers` - List managers
- `GET /managers/:id/earnings` - Manager earnings

### Transactions
- `GET /transactions` - List transactions
- `POST /uploads/excel` - Upload Excel files

### Bonuses
- `GET /bonuses` - List bonuses

---

## 🚀 Deployment

### Production Deployment

```bash
# One command deploys everything!
./deploy-firebase.sh
```

### What gets deployed:
1. **Frontend** → Firebase Hosting
2. **Backend API** → Cloud Functions  
3. **Database** → Firestore
4. **Security Rules** → Applied automatically

### Your live URLs:
- **Frontend**: `https://trend4media-billing.web.app`
- **API**: `https://europe-west1-trend4media-billing.cloudfunctions.net/api`

---

## ✅ Benefits Over Previous Setup

| Old Setup | Firebase Setup |
|-----------|----------------|
| ❌ Docker build errors | ✅ No containers needed |
| ❌ Railway/Nixpacks issues | ✅ Serverless functions |
| ❌ PostgreSQL setup | ✅ Managed Firestore |
| ❌ Complex deployments | ✅ One-command deploy |
| ❌ Manual scaling | ✅ Auto-scaling |
| ❌ Multiple services | ✅ Integrated platform |

---

## 📞 Support

If you need help:
1. Check Firebase Console for deployment status
2. Use `firebase functions:log` for backend errors
3. Use browser dev tools for frontend issues
4. Firebase emulators for local testing: `firebase emulators:start`

**No more Docker errors! 🎉** 