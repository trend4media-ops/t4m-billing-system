# Trend4Media LIVE Billing – SaaS Productization Guide

This document explains how the product becomes a fully automated SaaS for external agencies and creators: plans, architecture, onboarding, billing, operations, security, and scalability.

## 1. Product Overview
- Purpose: End‑to‑end TikTok LIVE agency operations: upload → calculate commissions → reports → payouts.
- Audience: Agencies, managers, creator networks.
- Value: Accurate commission engine, transparent reports, payout automation, configurable rules.

## 2. Core Capabilities
- Commission engine (base, milestones, graduation, diamond, incentives, downline)
- Excel uploads with real‑time processing and audit logs
- Payout request flow with invoice upload and admin workflow
- Multi‑tenant admin, messages/notifications
- Analytics and exports

## 3. SaaS Plans & Billing
- Plans (example):
  - Starter: 5 managers, basic reports
  - Pro: 25 managers, incentives + downline, priority support
  - Enterprise: unlimited, custom SLA and SSO
- Billing Platform: Stripe Billing (recommended)
  - Subscriptions: monthly/annual; trials; coupon support; proration
  - Taxes (Stripe Tax) and invoices
  - Customer Portal for self‑service (change plan, update payment method)
- Optional PayPal: Add via PayPal Subscriptions or Braintree gateway as an alternative checkout.

## 4. Multi‑Tenancy Model
- Tenant isolation:
  - `tenants` collection holds config: plan, status, stripeCustomerId, subscriptionId, trialEndsAt
  - Every business collection includes `tenantId`
  - Security rules enforce `request.auth.token.tenantId == resource.data.tenantId`
- Roles per tenant:
  - OWNER, ADMIN, MANAGER, VIEWER via Firebase custom claims

## 5. Onboarding & Access Control
- Landing → Pricing → Sign Up → Stripe Checkout
- Webhook (checkout.session.completed) provisions `tenant`, sets `active` status
- Post‑payment wizard:
  - Invite teammates, upload first Excel, set bank details, read quick guide
- Login gating: if subscription inactive or trial expired → redirect to billing portal

## 6. Architecture
- Frontend: Next.js on Firebase Hosting
  - Marketing site (landing, pricing, docs) + App under `/app` or subdomain
- Backend: Firebase Functions (HTTP and schedulers)
- Database: Firestore (multi‑tenant)
- Storage: Google Cloud Storage (Excel files, invoices, creator docs)
- Environments: staging/prod Firebase projects; CI/CD deploy per env
- Domains: `www.trend4media.com` (marketing), `app.trend4media.com` (app)

## 7. Billing Integration (Stripe)
- Required endpoints (HTTP functions):
  - POST `/billing/checkout` (create checkout session for a plan)
  - GET `/billing/portal` (customer portal link)
  - POST `/billing/webhook` (handle subscription lifecycle)
- Webhook handling events:
  - `checkout.session.completed`: provision tenant, mark active
  - `customer.subscription.updated`/`deleted`: update plan/status; gate access
  - `invoice.payment_failed`: mark grace state, notify OWNER
- Tenant schema example:
```
{
  id: string,
  name: string,
  ownerUserId: string,
  stripeCustomerId: string,
  subscriptionId: string,
  plan: 'starter'|'pro'|'enterprise',
  status: 'active'|'past_due'|'canceled'|'trialing',
  trialEndsAt?: Timestamp,
  createdAt: Timestamp,
}
```

## 8. App Gating & Feature Flags
- Gate by tenant status (active or trialing)
- Feature flags by plan: incentives, downline, export limits
- Claims update after plan changes; FE reads feature flags from `/tenants/{tenantId}`

## 9. Payouts and Finance Ops
- SEPA/CSV export for batch payouts
- Reconciliation upload to mark paid; webhook to accounting if configured
- SLA dashboard: pending requests aging, escalation emails

## 10. Operations & Reliability
- Webhook queue with retry/backoff; dead-letter logs and replay tool
- Monitoring:
  - Cloud Monitoring: errors, latency, 5xx alarms
  - Sentry for FE/BE error tracking
- Backups: scheduled Firestore export and Storage lifecycle policies
- Indexes: maintained in `firestore.indexes.json`

## 11. Security & Compliance
- Rate limiting, helmet/cors/hpp in HTTP handlers
- Secrets via Firebase Config or environment variables
- KYC/TAX optional gating for payouts
- GDPR features: user/tenant export & delete
- Legal: terms, privacy, cookie policy; email verification required

## 12. DevOps & CI/CD
- Branch-based deploy: `main` → staging; `release/*` → production
- Automated tests and smoke tests (Playwright) for core flows

## 13. Marketing Site
- Pages: Home, Features, Pricing, Docs, Legal, Contact
- CTA to Stripe Checkout; testimonials; system status link
- Docs include: quickstart, upload template, payout rules, FAQ

## 14. Support & Success
- In‑app `Help` sidebar (guide, FAQs, contact)
- Onboarding checklist (visible until completed)
- Status page + incident comms

## 15. Configuration Summary (env)
- `STRIPE_API_KEY`, `STRIPE_WEBHOOK_SECRET`
- `HOSTING_URL`, `APP_URL`
- `PAYOUT_WEBHOOK_URL` (optional)
- `SENTRY_DSN` (optional)

---
This guide defines how the product runs as a fully automated SaaS with tenant isolation, subscription management, operational resilience, and self‑serve UX. 