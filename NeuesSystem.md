# trend4media Frontend

Modern React/Next.js Frontend für das trend4media Abrechnungssystem mit TypeScript, Tailwind CSS und vollständiger API-Integration.

## 🚀 **Aktueller Status:**

**✅ Phase 5.1-5.2 Abgeschlossen - Frontend Grundgerüst**

### 🔧 **Implementierte Features:**
- [x] **Next.js 14 App Router** mit TypeScript
- [x] **Tailwind CSS** mit trend4media Branding (#ED0C81)
- [x] **Authentication System** mit JWT und Context API
- [x] **Protected Routes** mit Role-based Access Control
- [x] **API Client** mit automatischer Token-Verwaltung
- [x] **Login System** mit Form-Validation (Zod + React Hook Form)
- [x] **Responsive Design** mit modernem UI
- [x] **Loading States** und Error Handling
- [x] **Automatic Redirects** basierend auf User Role

### 🎨 **Design System:**
- **Brand Color**: #ED0C81 (trend4media Rosa)
- **Typography**: Inter Font für moderne Lesbarkeit
- **UI Components**: Custom Tailwind Classes
- **Layout**: Container-based mit responsive Breakpoints
- **Cards**: Soft shadows und rounded corners
- **Buttons**: Primary, Secondary, Outline Variants

## 🛠️ **Tech Stack:**

- **Framework**: Next.js 14 (App Router)
- **Language**: TypeScript
- **Styling**: Tailwind CSS
- **State Management**: React Context API
- **Forms**: React Hook Form + Zod Validation
- **HTTP Client**: Axios
- **Charts**: Recharts (ready for Phase 5.3)
- **Icons**: Lucide React

## 📁 **Projekt-Struktur:**

```
src/
├── app/                    # Next.js App Router Pages
│   ├── login/             # Login Page
│   ├── dashboard/         # Manager Dashboard
│   ├── admin/             # Admin Panel
│   ├── layout.tsx         # Root Layout mit AuthProvider
│   └── page.tsx           # Homepage mit Auto-Redirect
├── components/            # Reusable Components
│   ├── ui/               # UI Components
│   │   └── LoadingSpinner.tsx
│   ├── LoginForm.tsx     # Login Form mit Validation
│   └── ProtectedRoute.tsx # Route Protection Wrapper
├── contexts/             # React Context
│   └── AuthContext.tsx   # Authentication State Management
├── lib/                  # Utilities
│   └── api.ts           # Centralized API Client
└── styles/
    └── globals.css       # Global Styles mit Tailwind
```

## 🚀 **Setup & Installation:**

1. **Dependencies installieren:**
   ```bash
   npm install
   ```

2. **Umgebungsvariablen konfigurieren:**
   ```bash
   cp .env.example .env.local
   ```
   
   Konfiguriere in `.env.local`:
   ```
   NEXT_PUBLIC_API_URL=http://localhost:3000
   ```

3. **Backend starten** (in separatem Terminal):
   ```bash
   cd ../trend4media-backend
   npm run start:dev
   ```

4. **Frontend starten:**
   ```bash
   npm run dev
   ```

5. **Zugriff:**
   - Frontend: `http://localhost:3001`
   - Backend API: `http://localhost:3000`

## 🔐 **Authentication Flow:**

### **Login Process:**
1. User gibt Credentials ein
2. Validation mit Zod Schema
3. API Call zum Backend `/auth/login`
4. JWT Token wird in Memory gespeichert
5. Automatische Weiterleitung basierend auf Role:
   - **Admin** → `/admin`
   - **Manager** → `/dashboard`

### **Route Protection:**
- `ProtectedRoute` Wrapper prüft Authentication
- Role-based Access mit `adminOnly` Flag
- Automatische Redirects bei fehlender Berechtigung
- 401 Handling mit automatischem Logout

### **Token Management:**
- JWT Token in Memory (secure)
- Automatische Header-Setzung bei API Calls
- Interceptors für expired Token handling
- Custom Event System für unauthorized access

## 📱 **Responsive Design:**

- **Mobile First** Approach
- **Breakpoints**: sm, md, lg, xl
- **Container**: Responsive mit max-width
- **Components**: Flexbox und Grid Layouts
- **Typography**: Responsive text sizes
- **Spacing**: Consistent padding/margins

## 🎨 **Brand Guidelines:**

### **Farben:**
```css
Primary: #ED0C81 (trend4media Brand)
Gray Scale: 50-950 (neutral)
Success: #22c55e
Error: #ef4444
Warning: #f59e0b
```

### **Typography:**
- **Font**: Inter (Google Fonts)
- **Weights**: 300, 400, 500, 600, 700
- **Line Height**: Optimiert für Lesbarkeit

### **Components:**
- **Buttons**: Rounded-xl mit hover states
- **Cards**: Soft shadows, rounded-2xl
- **Inputs**: Focus rings in brand color
- **Loading**: Branded spinner

## 🔌 **API Integration:**

### **Centralized Client** (`src/lib/api.ts`):
```typescript
// Authentication
authApi.login(credentials)
authApi.getCurrentUser()

// Manager Earnings (ready)
managersApi.getEarnings(managerId, month)
managersApi.getAllEarnings(month)

// Uploads (ready)
uploadsApi.uploadExcel(file)
uploadsApi.getUploadBatches()

// Genealogy (ready)
genealogyApi.getAll()
genealogyApi.create(assignment)
```

### **Error Handling:**
- Global interceptors
- Automatic 401 handling
- User-friendly error messages
- Loading states for all requests

## 🧪 **Testing Ready:**

Die Struktur ist vorbereitet für:
- **Unit Tests**: React Testing Library
- **Integration Tests**: Jest + Testing Library
- **E2E Tests**: Playwright/Cypress
- **Component Tests**: Storybook (optional)

## 📋 **Verfügbare Scripts:**

```bash
npm run dev          # Development Server
npm run build        # Production Build
npm run start        # Production Server
npm run lint         # ESLint
npm run type-check   # TypeScript Check
```

## 🔄 **Development Workflow:**

1. **Backend läuft** auf Port 3000
2. **Frontend läuft** auf Port 3001
3. **Auto-reload** bei Änderungen
4. **TypeScript Check** in IDE
5. **Tailwind IntelliSense** für CSS

## 🎯 **Nächste Phase (5.3-5.4):**

**Bereit für Implementation:**
- [x] Manager Dashboard mit Earnings Charts
- [x] Admin Upload Interface
- [x] Genealogy Management UI
- [x] Manager Reports Dashboard
- [x] Bonus Management Interface

**API Endpunkte verfügbar:**
- ✅ `GET /managers/:id/earnings?month=YYYYMM`
- ✅ `GET /managers/earnings?month=YYYYMM`
- ✅ `POST /uploads/excel`
- ✅ `GET /uploads/batches`
- ✅ `POST /genealogy`
- ✅ `GET /genealogy/team/:id`

---

## ✅ **Frontend Grundgerüst Abgeschlossen**

Das initiale Frontend-Setup ist vollständig implementiert und bereit für die erweiterten Dashboard- und Admin-Features in der nächsten Phase.

**Login-Test verfügbar mit Backend Admin-User:**
- Email: `admin@trend4media.com`
- Password: `AdminPassword123!`

**Status: ✅ Bereit für Phase 5.3-5.4 (Dashboard & Admin Panel Implementation)** 