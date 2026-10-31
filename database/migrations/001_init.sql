-- 001_init.sql: Core schema for Brightloop Billing platform

-- Enable necessary extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- Enum Types
DO $$ BEGIN
    CREATE TYPE user_role AS ENUM ('admin', 'staff', 'customer');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE billing_period AS ENUM ('daily', 'weekly', 'monthly', 'yearly');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE sub_status AS ENUM ('draft', 'quotation', 'confirmed', 'active', 'closed');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE invoice_status AS ENUM ('draft', 'confirmed', 'paid', 'cancelled');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE discount_type AS ENUM ('fixed', 'percentage');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE discount_scope AS ENUM ('product', 'subscription');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE payment_method AS ENUM ('credit_card', 'bank_transfer', 'cash', 'stripe', 'paypal');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Number Sequences for formatted IDs
CREATE SEQUENCE IF NOT EXISTS subscription_number_seq START WITH 1 INCREMENT BY 1;
CREATE SEQUENCE IF NOT EXISTS invoice_number_seq START WITH 1 INCREMENT BY 1;

-- 1. Users Table
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    name VARCHAR(255) NOT NULL,
    role user_role NOT NULL DEFAULT 'customer',
    is_active BOOLEAN NOT NULL DEFAULT true,
    must_change_password BOOLEAN NOT NULL DEFAULT false,
    failed_login_attempts INT NOT NULL DEFAULT 0,
    locked_until TIMESTAMPTZ,
    last_login_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT check_email_normalized CHECK (email = lower(trim(email)))
);

-- 2. Password Reset Tokens
CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash VARCHAR(64) NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 3. Refresh Tokens (rotating)
CREATE TABLE IF NOT EXISTS refresh_tokens (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash VARCHAR(64) NOT NULL UNIQUE,
    family_id UUID NOT NULL,
    is_revoked BOOLEAN NOT NULL DEFAULT false,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 4. Customers Table
CREATE TABLE IF NOT EXISTS customers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID UNIQUE REFERENCES users(id) ON DELETE RESTRICT,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) NOT NULL,
    phone VARCHAR(50),
    company VARCHAR(255),
    address_line1 VARCHAR(255),
    address_line2 VARCHAR(255),
    city VARCHAR(100),
    state VARCHAR(100),
    postal_code VARCHAR(20),
    country VARCHAR(100) DEFAULT 'US',
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 5. Products Table
CREATE TABLE IF NOT EXISTS products (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    base_price NUMERIC(12,2) NOT NULL DEFAULT 0.00,
    is_active BOOLEAN NOT NULL DEFAULT true,
    is_archived BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT check_base_price_positive CHECK (base_price >= 0)
);

-- 6. Product Variants Table
CREATE TABLE IF NOT EXISTS product_variants (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    attribute VARCHAR(100) NOT NULL,
    value VARCHAR(100) NOT NULL,
    extra_price NUMERIC(12,2) NOT NULL DEFAULT 0.00,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_product_variant UNIQUE (product_id, attribute, value),
    CONSTRAINT check_variant_extra_price CHECK (extra_price >= 0)
);

-- 7. Taxes Table
CREATE TABLE IF NOT EXISTS taxes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(100) NOT NULL,
    rate NUMERIC(5,2) NOT NULL, -- percentage e.g. 10.00 for 10%
    description TEXT,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT check_tax_rate CHECK (rate >= 0 AND rate <= 100)
);

-- 8. Product Taxes Junction
CREATE TABLE IF NOT EXISTS product_taxes (
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    tax_id UUID NOT NULL REFERENCES taxes(id) ON DELETE RESTRICT,
    PRIMARY KEY (product_id, tax_id)
);

-- 9. Plans Table
CREATE TABLE IF NOT EXISTS plans (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    period billing_period NOT NULL,
    price NUMERIC(12,2) NOT NULL DEFAULT 0.00,
    min_quantity INT NOT NULL DEFAULT 1,
    available_from DATE,
    available_to DATE,
    auto_close BOOLEAN NOT NULL DEFAULT false,
    closable BOOLEAN NOT NULL DEFAULT true,
    pausable BOOLEAN NOT NULL DEFAULT true,
    renewable BOOLEAN NOT NULL DEFAULT true,
    version INT NOT NULL DEFAULT 1,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT check_plan_min_quantity CHECK (min_quantity >= 1),
    CONSTRAINT check_plan_price CHECK (price >= 0),
    CONSTRAINT check_plan_dates CHECK (available_to IS NULL OR available_from IS NULL OR available_to >= available_from)
);

-- 10. Quotation Templates Table
CREATE TABLE IF NOT EXISTS quotation_templates (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    plan_id UUID NOT NULL REFERENCES plans(id) ON DELETE RESTRICT,
    validity_days INT NOT NULL DEFAULT 30,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT check_validity_days CHECK (validity_days >= 1)
);

-- 11. Quotation Template Lines Table
CREATE TABLE IF NOT EXISTS quotation_template_lines (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    template_id UUID NOT NULL REFERENCES quotation_templates(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    variant_id UUID REFERENCES product_variants(id) ON DELETE SET NULL,
    quantity INT NOT NULL DEFAULT 1,
    CONSTRAINT check_template_line_quantity CHECK (quantity >= 1)
);

-- 12. Subscriptions Table
CREATE TABLE IF NOT EXISTS subscriptions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    subscription_number VARCHAR(50) NOT NULL UNIQUE DEFAULT ('SUB-' || LPAD(nextval('subscription_number_seq')::TEXT, 4, '0')),
    customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
    plan_id UUID NOT NULL REFERENCES plans(id) ON DELETE RESTRICT,
    status sub_status NOT NULL DEFAULT 'draft',
    start_date DATE NOT NULL,
    expiry_date DATE,
    next_billing_date DATE,
    paused_until DATE,
    notes TEXT,
    version INT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT check_subscription_expiry CHECK (expiry_date IS NULL OR expiry_date >= start_date)
);

-- 13. Subscription Lines Table
CREATE TABLE IF NOT EXISTS subscription_lines (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    subscription_id UUID NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    variant_id UUID REFERENCES product_variants(id) ON DELETE SET NULL,
    unit_price NUMERIC(12,2) NOT NULL,
    quantity INT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT check_sub_line_quantity CHECK (quantity >= 1),
    CONSTRAINT check_sub_line_price CHECK (unit_price >= 0)
);

-- 14. Discounts Table
CREATE TABLE IF NOT EXISTS discounts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    code VARCHAR(100) UNIQUE,
    type discount_type NOT NULL,
    value NUMERIC(12,2) NOT NULL,
    scope discount_scope NOT NULL DEFAULT 'subscription',
    min_purchase NUMERIC(12,2) DEFAULT 0.00,
    min_quantity INT DEFAULT 0,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    usage_limit INT,
    used_count INT NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT check_discount_type_value CHECK (
        (type = 'percentage' AND value > 0 AND value <= 100) OR
        (type = 'fixed' AND value > 0)
    ),
    CONSTRAINT check_discount_usage_limit CHECK (usage_limit IS NULL OR used_count <= usage_limit),
    CONSTRAINT check_discount_dates CHECK (end_date >= start_date)
);

-- 15. Discount Junction Tables
CREATE TABLE IF NOT EXISTS discount_products (
    discount_id UUID NOT NULL REFERENCES discounts(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    PRIMARY KEY (discount_id, product_id)
);

CREATE TABLE IF NOT EXISTS discount_subscriptions (
    discount_id UUID NOT NULL REFERENCES discounts(id) ON DELETE CASCADE,
    subscription_id UUID NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
    PRIMARY KEY (discount_id, subscription_id)
);

-- 16. Invoices Table
CREATE TABLE IF NOT EXISTS invoices (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    invoice_number VARCHAR(50) NOT NULL UNIQUE DEFAULT ('INV-' || LPAD(nextval('invoice_number_seq')::TEXT, 4, '0')),
    subscription_id UUID NOT NULL REFERENCES subscriptions(id) ON DELETE RESTRICT,
    customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
    status invoice_status NOT NULL DEFAULT 'draft',
    invoice_date DATE NOT NULL,
    due_date DATE NOT NULL,
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    subtotal NUMERIC(12,2) NOT NULL DEFAULT 0.00,
    discount_amount NUMERIC(12,2) NOT NULL DEFAULT 0.00,
    tax_amount NUMERIC(12,2) NOT NULL DEFAULT 0.00,
    total NUMERIC(12,2) NOT NULL DEFAULT 0.00,
    amount_paid NUMERIC(12,2) NOT NULL DEFAULT 0.00,
    applied_discount_id UUID REFERENCES discounts(id) ON DELETE SET NULL,
    last_reminder_stage INT NOT NULL DEFAULT 0, -- 0 = none, 1 = 3d, 2 = 7d, 3 = 14d
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_invoice_period UNIQUE (subscription_id, period_start, period_end),
    CONSTRAINT check_invoice_due_date CHECK (due_date >= invoice_date),
    CONSTRAINT check_invoice_period CHECK (period_end >= period_start),
    CONSTRAINT check_invoice_totals CHECK (
        subtotal >= 0 AND discount_amount >= 0 AND tax_amount >= 0 AND total >= 0 AND amount_paid >= 0 AND amount_paid <= total
    )
);

-- 17. Invoice Lines Table
CREATE TABLE IF NOT EXISTS invoice_lines (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    variant_id UUID REFERENCES product_variants(id) ON DELETE SET NULL,
    description TEXT NOT NULL,
    quantity INT NOT NULL DEFAULT 1,
    unit_price NUMERIC(12,2) NOT NULL,
    tax_rate NUMERIC(5,2) NOT NULL DEFAULT 0.00,
    discount_amount NUMERIC(12,2) NOT NULL DEFAULT 0.00,
    tax_amount NUMERIC(12,2) NOT NULL DEFAULT 0.00,
    line_total NUMERIC(12,2) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT check_inv_line_quantity CHECK (quantity >= 1),
    CONSTRAINT check_inv_line_prices CHECK (unit_price >= 0 AND line_total >= 0)
);

-- 18. Discount Redemptions Table
CREATE TABLE IF NOT EXISTS discount_redemptions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    discount_id UUID NOT NULL REFERENCES discounts(id) ON DELETE RESTRICT,
    invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    amount NUMERIC(12,2) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_discount_invoice UNIQUE (discount_id, invoice_id)
);

-- 19. Payments Table
CREATE TABLE IF NOT EXISTS payments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
    amount NUMERIC(12,2) NOT NULL,
    payment_method payment_method NOT NULL,
    payment_date DATE NOT NULL,
    reference VARCHAR(100) NOT NULL,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_invoice_payment_reference UNIQUE (invoice_id, reference)
);

-- 20. Billing Runs Table
CREATE TABLE IF NOT EXISTS billing_runs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    run_date DATE NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'completed',
    created_count INT NOT NULL DEFAULT 0,
    skipped_count INT NOT NULL DEFAULT 0,
    failed_count INT NOT NULL DEFAULT 0,
    error_logs JSONB DEFAULT '[]'::jsonb,
    started_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMPTZ
);

-- 21. Audit Log Table (Append-only)
CREATE TABLE IF NOT EXISTS audit_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    action VARCHAR(100) NOT NULL,
    entity VARCHAR(100) NOT NULL,
    entity_id VARCHAR(100) NOT NULL,
    before_state JSONB,
    after_state JSONB,
    ip_address VARCHAR(50),
    user_agent TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 22. Email Outbox Table
CREATE TABLE IF NOT EXISTS email_outbox (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    recipient VARCHAR(255) NOT NULL,
    subject VARCHAR(255) NOT NULL,
    body_text TEXT NOT NULL,
    body_html TEXT,
    status VARCHAR(50) NOT NULL DEFAULT 'pending', -- pending, sent, failed
    attempts INT NOT NULL DEFAULT 0,
    last_error TEXT,
    sent_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- INDEXES for Query Optimization & Hot Paths
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_subscriptions_next_billing ON subscriptions(next_billing_date) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_subscriptions_customer_status ON subscriptions(customer_id, status);
CREATE INDEX IF NOT EXISTS idx_invoices_customer ON invoices(customer_id);
CREATE INDEX IF NOT EXISTS idx_invoices_due_date_confirmed ON invoices(due_date) WHERE status = 'confirmed';
CREATE INDEX IF NOT EXISTS idx_invoices_status_date ON invoices(status, invoice_date);
CREATE INDEX IF NOT EXISTS idx_payments_invoice ON payments(invoice_id);
CREATE INDEX IF NOT EXISTS idx_invoice_lines_invoice ON invoice_lines(invoice_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_entity_id ON audit_log(entity, entity_id);
CREATE INDEX IF NOT EXISTS idx_customers_name_trgm ON customers USING gin(name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_customers_email_trgm ON customers USING gin(email gin_trgm_ops);

-- TRIGGERS & INTEGRITY RULES

-- A. Append-only enforcement on audit_log
CREATE OR REPLACE FUNCTION trg_block_audit_modifications()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'audit_log is strictly append-only. Modification or deletion is forbidden.';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS block_audit_log_update_delete ON audit_log;
CREATE TRIGGER block_audit_log_update_delete
BEFORE UPDATE OR DELETE ON audit_log
FOR EACH ROW
EXECUTE FUNCTION trg_block_audit_modifications();

-- B. Block modifications to invoice_lines on confirmed or paid invoices
CREATE OR REPLACE FUNCTION trg_protect_immutable_invoice_lines()
RETURNS TRIGGER AS $$
DECLARE
    v_status invoice_status;
BEGIN
    IF TG_OP = 'DELETE' THEN
        SELECT status INTO v_status FROM invoices WHERE id = OLD.invoice_id;
    ELSE
        SELECT status INTO v_status FROM invoices WHERE id = NEW.invoice_id;
    END IF;

    IF v_status IS NOT NULL AND v_status != 'draft' THEN
        RAISE EXCEPTION 'Invoice lines are immutable once the invoice is confirmed, paid, or cancelled.';
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS protect_immutable_invoice_lines ON invoice_lines;
CREATE TRIGGER protect_immutable_invoice_lines
BEFORE INSERT OR UPDATE OR DELETE ON invoice_lines
FOR EACH ROW
EXECUTE FUNCTION trg_protect_immutable_invoice_lines();

-- C. Block UPDATE/DELETE on payments table (corrections require reversal entries)
CREATE OR REPLACE FUNCTION trg_protect_immutable_payments()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'Payments are immutable. Corrections must be recorded via reversal entries.';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS protect_immutable_payments ON payments;
CREATE TRIGGER protect_immutable_payments
BEFORE UPDATE OR DELETE ON payments
FOR EACH ROW
EXECUTE FUNCTION trg_protect_immutable_payments();

-- REPORTING OBJECTS

-- 1. View: Overdue Invoices
CREATE OR REPLACE VIEW v_overdue_invoices AS
SELECT 
    i.id,
    i.invoice_number,
    i.subscription_id,
    i.customer_id,
    c.name AS customer_name,
    c.email AS customer_email,
    i.status,
    i.invoice_date,
    i.due_date,
    (CURRENT_DATE - i.due_date) AS days_overdue,
    i.total,
    i.amount_paid,
    (i.total - i.amount_paid) AS outstanding_amount,
    i.last_reminder_stage
FROM invoices i
JOIN customers c ON c.id = i.customer_id
WHERE i.status = 'confirmed' 
  AND i.due_date < CURRENT_DATE
  AND (i.total - i.amount_paid) > 0;

-- 2. Materialized View: Monthly Revenue
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_monthly_revenue AS
SELECT 
    TO_CHAR(i.invoice_date, 'YYYY-MM') AS month,
    COUNT(i.id) AS total_invoices,
    SUM(i.total) AS billed_revenue,
    SUM(i.amount_paid) AS collected_revenue,
    SUM(i.total - i.amount_paid) AS outstanding_revenue
FROM invoices i
WHERE i.status IN ('confirmed', 'paid')
GROUP BY TO_CHAR(i.invoice_date, 'YYYY-MM')
ORDER BY month DESC;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_monthly_revenue_month ON mv_monthly_revenue(month);

-- 3. Materialized View: Dashboard Summary
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_dashboard_summary AS
SELECT 
    (SELECT COUNT(*) FROM subscriptions WHERE status = 'active') AS active_subscriptions,
    (SELECT COALESCE(SUM(amount_paid), 0) FROM invoices WHERE status IN ('confirmed', 'paid')) AS total_revenue_collected,
    (SELECT COALESCE(SUM(total - amount_paid), 0) FROM invoices WHERE status = 'confirmed') AS total_outstanding,
    (SELECT COUNT(*) FROM invoices WHERE status = 'confirmed' AND due_date < CURRENT_DATE AND (total - amount_paid) > 0) AS overdue_count,
    (SELECT COALESCE(SUM(
        CASE 
            WHEN p.period = 'monthly' THEN p.price
            WHEN p.period = 'yearly' THEN p.price / 12.0
            WHEN p.period = 'weekly' THEN p.price * 4.33
            WHEN p.period = 'daily' THEN p.price * 30.0
            ELSE 0
        END
    ), 0)
    FROM subscriptions s
    JOIN plans p ON p.id = s.plan_id
    WHERE s.status = 'active') AS mrr
;
