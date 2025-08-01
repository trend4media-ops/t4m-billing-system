# 🚀 T4M Billing System

**Complete billing and commission management system for trend4media GmbH**

## 📋 Repository Structure

```
t4m-billing-system/
├── trend4media-backend/     # NestJS API Backend
├── trend4media-frontend/    # Next.js React Frontend  
├── functions/               # Firebase Cloud Functions
├── src/                     # Shared source code
├── docs/                    # Documentation
└── .github/                 # GitHub Actions & CI/CD
```

## 🎯 Features

### 💼 **Manager Dashboard**
- **Live Managers**: Track streaming performance & earnings
- **Team Managers**: Manage creator teams & commissions
- **Earnings Overview**: Real-time commission calculations
- **Genealogy Tree**: Visual representation of manager hierarchies

### 👨‍💼 **Admin Panel**
- **Excel Upload**: Batch process transaction data
- **User Management**: Manage managers and creators
- **Commission Rates**: Configure payout structures
- **Reports & Analytics**: Comprehensive financial reporting

### 🔐 **Authentication & Security**
- JWT-based authentication
- Role-based access control (Admin, Manager)
- Secure API endpoints
- Input validation & sanitization

## 🛠️ Tech Stack

### Backend
- **Framework**: NestJS (Node.js)
- **Database**: PostgreSQL with TypeORM
- **Authentication**: JWT + Passport
- **API Documentation**: Swagger/OpenAPI
- **Testing**: Jest + Supertest

### Frontend  
- **Framework**: Next.js 14 (React)
- **Styling**: Tailwind CSS
- **State Management**: React Context
- **Charts**: Chart.js
- **Testing**: Jest + React Testing Library + Playwright

## 🚀 Quick Start

### Prerequisites
- Node.js 18+
- PostgreSQL 14+
- Git

### Backend Setup
```bash
cd trend4media-backend
npm install
cp .env.example .env  # Configure your environment
npm run start:dev     # Runs on http://localhost:3000
```

### Frontend Setup
```bash
cd trend4media-frontend
npm install
cp .env.example .env.local  # Configure API URL
npm run dev               # Runs on http://localhost:3000
```

### Database Setup
```bash
# Backend automatically creates tables via TypeORM
# Sample data seeding available
npm run seed:staging
```

## 📊 API Documentation

- **Swagger UI**: http://localhost:3000/api
- **Health Check**: http://localhost:3000/health
- **Authentication**: POST /auth/login
- **Manager Earnings**: GET /managers/earnings
- **Excel Upload**: POST /uploads/excel

## 🧪 Testing

### Backend Tests
```bash
cd trend4media-backend
npm run test        # Unit tests
npm run test:e2e    # Integration tests
npm run test:cov    # Coverage report
```

### Frontend Tests  
```bash
cd trend4media-frontend
npm run test        # Unit tests
npm run test:e2e    # Playwright E2E tests
npm run test:smoke  # Smoke tests
```

## 🚀 Deployment

### Production Ready
- **Backend**: Railway, Heroku, or DigitalOcean
- **Frontend**: Vercel, Netlify, or Static hosting
- **Database**: PostgreSQL (managed service recommended)

### CI/CD Pipeline
- ✅ Automated testing on PR
- ✅ Deployment to staging/production
- ✅ Docker containerization ready
- ✅ Environment-based configurations

## 📁 Key Components

### Backend Services
- `AuthService` - JWT authentication & user management
- `ManagersService` - Manager operations & earnings
- `TransactionsService` - Financial transaction processing
- `GenealogyService` - Hierarchical relationship management
- `UploadsService` - Excel file processing

### Frontend Components
- `LoginForm` - Authentication interface
- `EarningsSummary` - Dashboard widgets
- `FileUpload` - Excel upload interface
- `EarningsChart` - Data visualization
- `ProtectedRoute` - Route-based security

## 🔧 Configuration

### Environment Variables

**Backend (.env)**
```env
DATABASE_URL=postgresql://user:pass@localhost:5432/t4m_db
JWT_SECRET=your-super-secure-jwt-secret
FRONTEND_URL=http://localhost:3001
NODE_ENV=development
```

**Frontend (.env.local)**
```env
NEXT_PUBLIC_API_URL=http://localhost:3000
```

## 📈 Status

- ✅ **Development**: Complete
- ✅ **Testing**: Comprehensive test suite 
- ✅ **Documentation**: Full API & user docs
- ✅ **Deployment**: Production-ready
- 🔄 **UAT**: Ready for stakeholder testing

## 📄 License

This project is proprietary software developed for trend4media GmbH.

**Repository**: [https://github.com/trend4media-ops/t4m-billing-system](https://github.com/trend4media-ops/t4m-billing-system)

---

**🚀 Status: READY FOR DEPLOYMENT**

*Last Updated: January 2025*  
*Version: 1.0*  
*Environment: Production Ready* 