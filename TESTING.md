# Testing & Deployment Guide

## 📋 Overview

This document outlines the comprehensive testing strategy and deployment process for the Trend4Media application, covering Unit Tests, E2E Tests, and CI/CD deployment.

## 🧪 Testing Strategy

### Coverage Requirements
- **Minimum Coverage**: 80% across all metrics
- **Statements**: 80%
- **Branches**: 80%
- **Functions**: 80%
- **Lines**: 80%

### Testing Pyramid
1. **Unit Tests (70%)**: Fast, isolated tests for individual functions and components
2. **Integration Tests (20%)**: Tests for API endpoints and component interactions
3. **E2E Tests (10%)**: Full user workflow testing

## 🔧 Backend Testing (NestJS + Jest)

### Setup
```bash
cd trend4media-backend
npm install
npm run test        # Run unit tests
npm run test:watch  # Run tests in watch mode
npm run test:cov    # Run tests with coverage
npm run test:e2e    # Run E2E tests
```

### Unit Tests
- **Location**: `src/**/*.spec.ts`
- **Framework**: Jest + Testing Library
- **Mocking**: All external dependencies mocked
- **Coverage**: 80% minimum threshold enforced

### Test Structure
```typescript
describe('ServiceName', () => {
  let service: ServiceName;
  let mockRepository: jest.Mocked<Repository<Entity>>;

  beforeEach(async () => {
    // Setup test module with mocked dependencies
  });

  describe('methodName', () => {
    it('should handle success case', async () => {
      // Arrange, Act, Assert
    });
    
    it('should handle error case', async () => {
      // Test error scenarios
    });
  });
});
```

### Key Services Tested
- ✅ **AuthService**: User authentication and JWT handling
- ✅ **ManagersService**: Manager operations and earnings calculations
- ✅ **UploadsService**: Excel processing and batch management
- ✅ **PayoutsService**: Payout request lifecycle
- ✅ **NotificationService**: Message delivery
- ✅ **AuditService**: Activity logging

## 🖥️ Frontend Testing (Next.js + Jest + Playwright)

### Setup
```bash
cd trend4media-frontend
npm install
npm run test:unit      # Unit tests
npm run test:watch     # Watch mode
npm run test:coverage  # Coverage report
npm run test:e2e       # E2E tests
npm run test:all       # All tests
```

### Unit Tests
- **Location**: `src/**/__tests__/*.test.tsx`
- **Framework**: Jest + React Testing Library
- **Components**: All UI components tested
- **Contexts**: Authentication and state management

### E2E Tests
- **Framework**: Playwright
- **Browsers**: Chrome, Firefox, Safari
- **Location**: `e2e/*.spec.ts`

## 🚀 Core Workflow E2E Tests

### Complete Upload→Batch→Earnings→Payout→Messaging Workflow

```typescript
// File: e2e/upload-to-payout-workflow.spec.ts
test('Complete workflow: Upload → Batch → Earnings → Payout → Messaging', async ({ page }) => {
  // 1. Admin uploads Excel file
  // 2. Batch created with transactions
  // 3. Manager views earnings
  // 4. Manager creates payout request
  // 5. Admin approves payout
  // 6. Admin sends notification
  // 7. Manager receives notification
});
```

### Batch Management Tests

```typescript
// File: e2e/batch-management.spec.ts
test('should display and manage upload batches', async ({ page }) => {
  // Test batch listing, filtering, details, deletion
});
```

### Test Coverage Areas

#### 1. Authentication Flow
- ✅ Admin/Manager login
- ✅ Role-based redirects
- ✅ Logout functionality
- ✅ Protected routes

#### 2. Upload Workflow
- ✅ Excel file upload
- ✅ Batch creation
- ✅ Transaction processing
- ✅ Error handling
- ✅ Warning display

#### 3. Earnings Management
- ✅ Manager dashboard
- ✅ Commission calculations
- ✅ Monthly breakdowns
- ✅ Creator rankings

#### 4. Payout System
- ✅ Payout request creation
- ✅ Available commission checks
- ✅ Admin approval workflow
- ✅ Status updates

#### 5. Messaging System
- ✅ Message composition
- ✅ Notification delivery
- ✅ Read/unread status
- ✅ Notification badges

## 🏗️ CI/CD Pipeline

### GitHub Actions Workflow
```yaml
# File: .github/workflows/ci-cd.yml
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - run: npm ci && npm run test:cov
      
  deploy:
    needs: test
    runs-on: ubuntu-latest
    steps:
      - run: firebase deploy --only hosting,functions
```

### Pipeline Stages

#### 1. Test Stage
- **Backend Tests**: Unit + Integration tests
- **Frontend Tests**: Component + Integration tests  
- **E2E Tests**: Full workflow validation
- **Coverage Check**: 80% threshold enforcement
- **Security Audit**: Dependency vulnerability scan

#### 2. Deploy Stage (Production)
- **Build**: Compile TypeScript and bundle assets
- **Deploy**: Firebase Hosting + Cloud Functions
- **Smoke Tests**: Basic functionality verification
- **Release**: Auto-tag and GitHub release creation

### Branch Strategy
- **main**: Production deployments
- **develop**: Staging deployments
- **feature/***: PR validation only

### Environment Variables Required
```bash
# GitHub Secrets
FIREBASE_TOKEN=<firebase-ci-token>
FIREBASE_PROJECT_ID=<production-project-id>
FIREBASE_PROJECT_ID_STAGING=<staging-project-id>
CODECOV_TOKEN=<codecov-upload-token>
```

## 📊 Test Reports & Monitoring

### Coverage Reports
- **Backend**: `trend4media-backend/coverage/lcov-report/index.html`
- **Frontend**: `trend4media-frontend/coverage/lcov-report/index.html`
- **Combined**: Uploaded to Codecov for tracking

### E2E Test Results
- **Reports**: `trend4media-frontend/playwright-report/`
- **Videos**: Recorded on test failures
- **Screenshots**: Captured on assertions

### Performance Monitoring
- **Lighthouse CI**: Performance budget enforcement
- **Bundle Analysis**: Size monitoring
- **Load Testing**: API endpoint performance

## 🐛 Debugging Tests

### Unit Tests
```bash
# Debug specific test
npm run test:debug -- --testNamePattern="AuthService"

# Watch mode for development
npm run test:watch
```

### E2E Tests
```bash
# Run with browser visible
npm run test:e2e:headed

# Debug mode with DevTools
npm run test:e2e:debug

# UI mode for interactive debugging
npm run test:e2e:ui
```

## 📝 Writing Tests

### Unit Test Guidelines
1. **Arrange, Act, Assert** pattern
2. **Mock all external dependencies**
3. **Test both success and error cases**
4. **Use descriptive test names**
5. **Keep tests focused and isolated**

### E2E Test Guidelines
1. **Test complete user workflows**
2. **Use data-testid attributes for selectors**
3. **Mock external API calls**
4. **Include error scenario testing**
5. **Keep tests deterministic**

### Best Practices
- **DRY**: Reuse test utilities and fixtures
- **Fast**: Keep unit tests under 100ms
- **Reliable**: Avoid flaky tests with proper waits
- **Maintainable**: Update tests with code changes
- **Readable**: Use clear assertions and descriptions

## 🚦 Quality Gates

### Pre-commit Hooks
- Linting (ESLint)
- Type checking (TypeScript)
- Unit test execution
- Coverage validation

### PR Requirements
- All tests must pass
- Coverage must meet 80% threshold
- E2E tests must pass
- Security audit must pass
- Performance budget must be met

### Deployment Blocks
- Failed unit tests
- Failed E2E tests
- Coverage below threshold
- Security vulnerabilities (high/critical)
- Failed smoke tests

## 📈 Metrics & Reporting

### Test Metrics Tracked
- **Coverage Percentage**: Statements, branches, functions, lines
- **Test Execution Time**: Performance monitoring
- **Flaky Test Rate**: Reliability tracking
- **E2E Success Rate**: Workflow stability

### Deployment Metrics
- **Build Success Rate**: CI/CD reliability
- **Deployment Frequency**: Release cadence
- **Mean Time to Recovery**: Incident response
- **Change Failure Rate**: Quality assessment

## 🎯 Next Steps

1. **Expand Test Coverage**: Add missing service tests
2. **Performance Tests**: API load testing
3. **Visual Regression**: Screenshot comparisons
4. **Mobile Testing**: Responsive E2E tests
5. **Accessibility**: A11y automated testing

---

## 📚 Additional Resources

- [Jest Documentation](https://jestjs.io/docs/getting-started)
- [Playwright Documentation](https://playwright.dev/)
- [React Testing Library](https://testing-library.com/docs/react-testing-library/intro/)
- [Firebase Testing](https://firebase.google.com/docs/emulator-suite)
- [GitHub Actions](https://docs.github.com/en/actions) 