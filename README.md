# Brightloop Billing

> **Enterprise Subscription Management & Recurring Billing Platform**  
> Automated idempotent invoicing, proportional discount allocation, immutable audit trails, and real-time financial dashboards. Built with PostgreSQL, Node.js / Express, and React / Vite.

---

## 🌟 Key Features

### 1. Robust Core Billing Engine
- **Idempotency Guarantee**: Unique compound constraint `(subscription_id, period_start, period_end)` guarantees exactly one invoice per billing cycle, even under parallel execution or worker crashes.
- **Pure Integer Cents Arithmetic**: Zero floating-point rounding inaccuracies. Invariant: `subtotal - discount + tax = total`.
- **Proportional Discount Engine**: Deterministic remainder penny allocation across line items. Thread-safe atomic claiming and release on cancellation.
- **Historical Immutability**: Line-item snapshot pricing and tax preservation ensures past invoices remain unmodified when product prices change.
- **State Machine**: Full subscription lifecycle (`draft` → `quotation` → `confirmed` → `active` → `paused` / `closed`) with strict transition rules.

### 2. Multi-Role RBAC & Security
- **Strict Role-Based Access Control**: `admin`, `staff`, and `customer` roles with IDOR protection.
- **Security Fortifications**: Rotating refresh tokens with token family revocation upon reuse detection, rate-limiting, Helmet headers, and bcrypt password hashing.

### 3. Real-Time Finance Dashboard & Operations
- **Financial Analytics**: MRR calculation, total cash collected, outstanding receivables, and overdue aging invoices.
- **Invoice & Payment Processing**: Confirm and cancel invoices, record payments, and auto-transition to `paid` upon full settlement.
- **Server-Sent Events (SSE)**: Real-time live events on `/api/events` for invoice generation, payment confirmation, and status updates.

---

## 📂 Architecture & Project Structure

```
Brightloop-Billing/
├── backend/
│   ├── src/
│   │   ├── app.ts                  # Express application setup, security, routes, SSE
│   │   ├── server.ts               # HTTP server bootstrap
│   │   ├── common/                 # Auth middleware, errors (RFC 9457), eventBus, logger
│   │   ├── billing/                # Billing engine, money math, period cycles, discount & tax engine
│   │   ├── modules/
│   │   │   ├── auth/               # User registration, login, token refresh, lockout
│   │   │   ├── catalog/            # Products, variants, soft-delete archiving
│   │   │   ├── customers/          # Customer CRUD, profiles, search & pagination
│   │   │   ├── discounts/          # Percentage and fixed discount promotions
│   │   │   ├── plans/              # Plans with optimistic locking (version)
│   │   │   ├── staff/              # Staff management and activation
│   │   │   ├── subscriptions/      # Subscription lifecycle & state machine
│   │   │   ├── taxes/              # Tax jurisdiction definitions
│   │   │   └── templates/          # Quotation templates with preset line items
│   │   └── db/
│   │       ├── pool.ts             # PostgreSQL connection pool & transaction runner
│   │       ├── migrate.ts          # Migration runner
│   │       └── seed.ts             # Complete database seed script
│   └── tests/                      # Vitest test suite with property-based testing
│
├── frontend/
│   ├── src/
│   │   ├── api/client.ts           # Axios client with auto-refresh token interceptor
│   │   ├── components/             # Layout (sidebar, topbar) & ProtectedRoute
│   │   ├── contexts/AuthContext.tsx# Authentication state provider
│   │   ├── pages/
│   │   │   ├── DashboardPage.tsx   # Revenue metrics, charts, and recent invoices
│   │   │   ├── SubscriptionsPage.tsx# Subscription lifecycle & transitions
│   │   │   ├── InvoicesPage.tsx    # Invoice ledger & confirmation actions
│   │   │   ├── PaymentsPage.tsx    # Payment records & ledger
│   │   │   ├── CustomersPage.tsx   # Customer directory & search
│   │   │   ├── CatalogPage.tsx     # Products & variants catalog
│   │   │   ├── PlansPage.tsx       # Billing plans & frequencies
│   │   │   ├── DiscountsPage.tsx   # Promotional coupons & usage limits
│   │   │   ├── TaxesPage.tsx       # Tax rules & jurisdiction percentages
│   │   │   ├── StaffPage.tsx       # Staff member administration & RBAC
│   │   │   ├── BillingRunsPage.tsx # Manual billing execution & run history
│   │   │   ├── ReportsPage.tsx     # Aging reports & financial analytics
│   │   │   ├── LoginPage.tsx       # User sign-in
│   │   │   └── RegisterPage.tsx    # Customer registration
│   │   ├── App.tsx                 # Full React Router configuration
│   │   └── main.tsx                # React 18 DOM root mount
│   └── vite.config.ts              # Vite + React plugin & API proxy
│
└── database/
    └── migrations/
        └── 001_init.sql            # Core PostgreSQL schema, views, triggers, sequences
```

---

## 🚀 Quick Start Guide

### 1. Prerequisites
- **Node.js** v20+
- **PostgreSQL** v14+ (or Docker)

### 2. Configure Environment
Create `.env` in `backend/`:
```env
PORT=5000
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/brightloop_billing
JWT_ACCESS_SECRET=supersecretaccesskey1234567890
JWT_REFRESH_SECRET=supersecretrefreshkey1234567890
CORS_ORIGIN=http://localhost:3000
```

### 3. Run Database Migrations & Seed Data
```bash
# Run PostgreSQL migrations
npm run migrate

# Seed sample users, catalog, plans, discounts, and subscriptions
npm run seed
```

**Default Seed Credentials:**
| Role | Email | Password |
|---|---|---|
| **Admin** | `admin@brightloop.io` | `Password123!` |
| **Staff** | `staff@brightloop.io` | `Password123!` |
| **Customer** | `customer@brightloop.io` | `Password123!` |

### 4. Start Development Servers
```bash
# Start backend API (http://localhost:5000)
npm run dev

# Start frontend application (http://localhost:3000)
npm run dev:frontend
```

### 5. Running Tests & Quality Checks
```bash
# Run unit and property-based test suites
npm test

# Build all workspaces
npm run build
```
