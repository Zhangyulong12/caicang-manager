-- 采仓管家 V1.0 - PostgreSQL 16+ reference schema
-- Intended to be translated to Prisma models/migrations. Run in a NEW EMPTY database only.
-- UUID: pgcrypto/gen_random_uuid (PostgreSQL 13+ built-in gen_random_uuid also supported).
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(150) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(320) NOT NULL UNIQUE,
  display_name VARCHAR(100) NOT NULL,
  password_hash TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE tenant_memberships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  user_id UUID NOT NULL REFERENCES users(id),
  role VARCHAR(20) NOT NULL CHECK (role IN ('OWNER','ADMIN','BUYER','WAREHOUSE','VIEWER')),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, user_id)
);
CREATE INDEX idx_membership_user ON tenant_memberships (user_id, is_active);

CREATE TABLE warehouses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  code VARCHAR(40) NOT NULL,
  name VARCHAR(100) NOT NULL,
  address TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, code)
);
CREATE TABLE products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  sku VARCHAR(80) NOT NULL,
  barcode VARCHAR(128),
  name VARCHAR(200) NOT NULL,
  specification VARCHAR(200),
  unit VARCHAR(20) NOT NULL DEFAULT '件',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, sku)
);
CREATE UNIQUE INDEX uq_product_barcode_not_null ON products(tenant_id, barcode) WHERE barcode IS NOT NULL;
CREATE INDEX idx_product_search ON products(tenant_id, name);

CREATE TABLE purchase_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  warehouse_id UUID NOT NULL,
  order_no VARCHAR(50) NOT NULL,
  platform VARCHAR(20) NOT NULL CHECK (platform IN ('TAOBAO','JD','PDD','OTHER')),
  platform_order_no VARCHAR(100),
  supplier_name VARCHAR(200),
  status VARCHAR(30) NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT','PLACED','PARTIAL_RECEIVED','RECEIVED','CANCELLED')),
  recipient_name VARCHAR(100),
  recipient_phone VARCHAR(50),
  recipient_address TEXT,
  freight_amount NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (freight_amount >= 0),
  remark TEXT,
  created_by UUID NOT NULL REFERENCES users(id),
  placed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, order_no),
  FOREIGN KEY (tenant_id, warehouse_id) REFERENCES warehouses(tenant_id, id)
);
CREATE INDEX idx_po_tenant_status_time ON purchase_orders(tenant_id, status, created_at DESC);
CREATE INDEX idx_po_platform_order ON purchase_orders(tenant_id, platform, platform_order_no);

CREATE TABLE purchase_order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  purchase_order_id UUID NOT NULL,
  product_id UUID NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_price NUMERIC(18,2) NOT NULL CHECK (unit_price >= 0),
  discount_amount NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
  -- landed_unit_cost: freight-allocated price, stored on confirmation; precision 4.
  landed_unit_cost NUMERIC(18,4) CHECK (landed_unit_cost IS NULL OR landed_unit_cost >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, id),
  UNIQUE(tenant_id, purchase_order_id, product_id),
  FOREIGN KEY (tenant_id, purchase_order_id) REFERENCES purchase_orders(tenant_id, id),
  FOREIGN KEY (tenant_id, product_id) REFERENCES products(tenant_id, id),
  CHECK (discount_amount <= quantity * unit_price)
);
CREATE INDEX idx_po_item_po ON purchase_order_items(tenant_id, purchase_order_id);

CREATE TABLE packages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  purchase_order_id UUID NOT NULL,
  carrier_code VARCHAR(40),
  tracking_no VARCHAR(128),
  status VARCHAR(30) NOT NULL DEFAULT 'CREATED'
    CHECK (status IN ('CREATED','IN_TRANSIT','ARRIVED','PARTIAL_RECEIVED','RECEIVED','EXCEPTION')),
  receiving_closed_at TIMESTAMPTZ,
  remark TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, id),
  FOREIGN KEY (tenant_id, purchase_order_id) REFERENCES purchase_orders(tenant_id, id),
  CHECK ((carrier_code IS NULL) = (tracking_no IS NULL))
);
-- A carrier + tracking number belongs to at most one package in a tenant.
CREATE UNIQUE INDEX uq_pkg_tracking ON packages(tenant_id, carrier_code, tracking_no) WHERE tracking_no IS NOT NULL;
CREATE INDEX idx_pkg_scan ON packages(tenant_id, tracking_no) WHERE tracking_no IS NOT NULL;
CREATE INDEX idx_pkg_order ON packages(tenant_id, purchase_order_id);

CREATE TABLE package_expected_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  package_id UUID NOT NULL,
  purchase_order_item_id UUID NOT NULL,
  expected_quantity INTEGER NOT NULL CHECK (expected_quantity > 0),
  UNIQUE(tenant_id, package_id, purchase_order_item_id),
  FOREIGN KEY (tenant_id, package_id) REFERENCES packages(tenant_id, id),
  FOREIGN KEY (tenant_id, purchase_order_item_id) REFERENCES purchase_order_items(tenant_id, id)
);
-- Service validates package and item refer to SAME purchase_order_id and aggregate expected qty <= ordered qty.

CREATE TABLE receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  receipt_no VARCHAR(50) NOT NULL,
  purchase_order_id UUID NOT NULL,
  package_id UUID NOT NULL,
  warehouse_id UUID NOT NULL,
  client_operation_id UUID NOT NULL,
  request_hash CHAR(64) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'CONFIRMED' CHECK (status = 'CONFIRMED'),
  received_by UUID NOT NULL REFERENCES users(id),
  remark TEXT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, id),
  UNIQUE(tenant_id, receipt_no),
  UNIQUE(tenant_id, client_operation_id),
  FOREIGN KEY (tenant_id, purchase_order_id) REFERENCES purchase_orders(tenant_id, id),
  FOREIGN KEY (tenant_id, package_id) REFERENCES packages(tenant_id, id),
  FOREIGN KEY (tenant_id, warehouse_id) REFERENCES warehouses(tenant_id, id)
);
CREATE INDEX idx_receipt_pkg ON receipts(tenant_id, package_id, received_at DESC);

CREATE TABLE receipt_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  receipt_id UUID NOT NULL,
  purchase_order_item_id UUID NOT NULL,
  product_id UUID NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  landed_unit_cost NUMERIC(18,4) NOT NULL CHECK (landed_unit_cost >= 0),
  UNIQUE(tenant_id, id),
  UNIQUE(tenant_id, receipt_id, purchase_order_item_id),
  FOREIGN KEY (tenant_id, receipt_id) REFERENCES receipts(tenant_id, id),
  FOREIGN KEY (tenant_id, purchase_order_item_id) REFERENCES purchase_order_items(tenant_id, id),
  FOREIGN KEY (tenant_id, product_id) REFERENCES products(tenant_id, id)
);
-- Service validates item belongs to receipt's order and the product matches purchased line.

CREATE TABLE stock_balances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  warehouse_id UUID NOT NULL,
  product_id UUID NOT NULL,
  quantity_on_hand INTEGER NOT NULL DEFAULT 0 CHECK (quantity_on_hand >= 0),
  total_cost NUMERIC(20,4) NOT NULL DEFAULT 0 CHECK (total_cost >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, warehouse_id, product_id),
  FOREIGN KEY (tenant_id, warehouse_id) REFERENCES warehouses(tenant_id, id),
  FOREIGN KEY (tenant_id, product_id) REFERENCES products(tenant_id, id)
);
CREATE INDEX idx_stock_product ON stock_balances(tenant_id, product_id);

CREATE TABLE outbound_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  warehouse_id UUID NOT NULL,
  outbound_no VARCHAR(50) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','SHIPPED','CANCELLED')),
  customer_name VARCHAR(100),
  customer_phone VARCHAR(50),
  customer_address TEXT,
  carrier_code VARCHAR(40),
  tracking_no VARCHAR(128),
  confirm_operation_id UUID,
  confirm_request_hash CHAR(64),
  remark TEXT,
  created_by UUID NOT NULL REFERENCES users(id),
  shipped_by UUID REFERENCES users(id),
  shipped_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, id),
  UNIQUE(tenant_id, outbound_no),
  UNIQUE(tenant_id, confirm_operation_id),
  FOREIGN KEY (tenant_id, warehouse_id) REFERENCES warehouses(tenant_id, id),
  CHECK (status <> 'SHIPPED' OR (shipped_at IS NOT NULL AND confirm_operation_id IS NOT NULL AND confirm_request_hash IS NOT NULL))
);
CREATE INDEX idx_outbound_status ON outbound_orders(tenant_id, status, created_at DESC);

CREATE TABLE outbound_order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  outbound_order_id UUID NOT NULL,
  product_id UUID NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  shipped_unit_cost NUMERIC(18,4) CHECK (shipped_unit_cost IS NULL OR shipped_unit_cost >= 0),
  UNIQUE(tenant_id, id),
  UNIQUE(tenant_id, outbound_order_id, product_id),
  FOREIGN KEY (tenant_id, outbound_order_id) REFERENCES outbound_orders(tenant_id, id),
  FOREIGN KEY (tenant_id, product_id) REFERENCES products(tenant_id, id)
);

CREATE TABLE stock_adjustments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  warehouse_id UUID NOT NULL,
  product_id UUID NOT NULL,
  quantity_delta INTEGER NOT NULL CHECK (quantity_delta <> 0),
  reason VARCHAR(100) NOT NULL,
  unit_cost_snapshot NUMERIC(18,4) NOT NULL CHECK (unit_cost_snapshot >= 0),
  client_operation_id UUID NOT NULL,
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, id),
  UNIQUE(tenant_id, client_operation_id),
  FOREIGN KEY (tenant_id, warehouse_id) REFERENCES warehouses(tenant_id, id),
  FOREIGN KEY (tenant_id, product_id) REFERENCES products(tenant_id, id)
);

CREATE TABLE stock_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  warehouse_id UUID NOT NULL,
  product_id UUID NOT NULL,
  source_type VARCHAR(20) NOT NULL CHECK (source_type IN ('RECEIPT','OUTBOUND','ADJUSTMENT')),
  source_item_id UUID NOT NULL,
  quantity_delta INTEGER NOT NULL CHECK (quantity_delta <> 0),
  cost_delta NUMERIC(20,4) NOT NULL,
  quantity_before INTEGER NOT NULL CHECK (quantity_before >= 0),
  quantity_after INTEGER NOT NULL CHECK (quantity_after >= 0),
  total_cost_before NUMERIC(20,4) NOT NULL CHECK (total_cost_before >= 0),
  total_cost_after NUMERIC(20,4) NOT NULL CHECK (total_cost_after >= 0),
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, source_type, source_item_id),
  FOREIGN KEY (tenant_id, warehouse_id) REFERENCES warehouses(tenant_id, id),
  FOREIGN KEY (tenant_id, product_id) REFERENCES products(tenant_id, id),
  CHECK (quantity_before + quantity_delta = quantity_after),
  CHECK (total_cost_before + cost_delta = total_cost_after)
);
CREATE INDEX idx_movement_filter ON stock_movements(tenant_id, warehouse_id, product_id, created_at DESC);

CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  actor_id UUID REFERENCES users(id),
  action VARCHAR(100) NOT NULL,
  object_type VARCHAR(80) NOT NULL,
  object_id UUID,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_tenant_time ON audit_logs(tenant_id, created_at DESC);

-- COMPLIANCE NOTES:
-- 1. No schema alone guarantees received quantities <= ordered: lock purchase order, aggregate receipts, and validate in application transaction.
-- 2. No schema alone guarantees package_expected_items belong to same purchase order as package: enforce in service (or add composite FK to triple-key in implementation).
-- 3. All child writes must use tenant-scoped relation lookups. User FK alone doesn't prove tenant membership: check membership in auth guard.
-- 4. Updates to inventory must be only through receipt/outbound/adjustment services. Never expose arbitrary update of stock_balances.
-- 5. This SQL is an initial executable reference, not a production migration history; Codex must generate tracked Prisma migrations.
