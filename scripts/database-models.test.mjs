import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { test } from 'node:test';
import { seedDatabase, seedTenants } from '../apps/api/dist/database/seed.js';

const apiRoot = fileURLToPath(new URL('../apps/api/', import.meta.url));
const requireApi = createRequire(new URL('../apps/api/package.json', import.meta.url));
const { Client } = requireApi('pg');
const runFile = promisify(execFile);
loadEnvFile(new URL('../.env', import.meta.url));
const sourceUrl = new URL(process.env.DATABASE_URL);
assert.ok(
  ['localhost', '127.0.0.1'].includes(sourceUrl.hostname),
  'Tests require local PostgreSQL.',
);
assert.equal(sourceUrl.pathname, '/caicang', 'Tests must start from the development connection.');
const tables = [
  'tenants',
  'users',
  'tenant_memberships',
  'warehouses',
  'products',
  'purchase_accounts',
  'purchase_returns',
  'purchase_return_items',
  'purchase_return_allocations',
  'purchase_orders',
  'purchase_order_items',
  'packages',
  'package_expected_items',
  'receipts',
  'receipt_items',
  'stock_balances',
  'outbound_orders',
  'outbound_order_items',
  'stock_adjustments',
  'stock_movements',
  'audit_logs',
];

test(
  'tracked migration, repeatable seed and real PostgreSQL constraints',
  { timeout: 180000 },
  async (t) => {
    const databaseName = `caicang_test_${randomUUID().replaceAll('-', '')}`;
    const admin = new Client({ connectionString: sourceUrl.toString() });
    const testUrl = new URL(sourceUrl);
    testUrl.pathname = `/${databaseName}`;
    let created = false;
    let db;
    const prisma = async (...args) => {
      const output = await runFile(
        process.execPath,
        [
          fileURLToPath(new URL('../apps/api/node_modules/prisma/build/index.js', import.meta.url)),
          ...args,
        ],
        {
          cwd: apiRoot,
          env: { ...process.env, DATABASE_URL: testUrl.toString() },
          windowsHide: true,
          timeout: 60000,
        },
      );
      return output.stdout;
    };
    try {
      await admin.connect();
      assert.match(databaseName, /^caicang_test_[a-f0-9]{32}$/);
      await admin.query(`CREATE DATABASE "${databaseName}"`);
      created = true;
      db = new Client({ connectionString: testUrl.toString() });
      await db.connect();
      await t.test(
        'migration deploy to a new empty database and second deploy are successful',
        async () => {
          assert.equal(
            (await db.query("SELECT count(*)::int AS n FROM pg_tables WHERE schemaname='public'"))
              .rows[0].n,
            0,
          );
          await prisma('migrate', 'deploy');
          await prisma('migrate', 'deploy');
          const rows = (
            await db.query(
              'SELECT migration_name, finished_at, rolled_back_at FROM _prisma_migrations',
            )
          ).rows;
          assert.equal(
            rows.length,
            (
              await readdir(new URL('../apps/api/prisma/migrations/', import.meta.url), {
                withFileTypes: true,
              })
            ).filter((entry) => entry.isDirectory()).length,
          );
          for (const row of rows) {
            assert.ok(row.finished_at);
            assert.equal(row.rolled_back_at, null);
          }
          assert.ok(
            rows.some(
              (row) => row.migration_name === '20261015090000_unique_normalized_user_email',
            ),
          );
          await prisma('migrate', 'status');
        },
      );
      await t.test(
        '21 business tables plus 2 authentication tables, UUID keys and tenant scoped data exist',
        async () => {
          const actual = (
            await db.query(
              "SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'",
            )
          ).rows
            .map((r) => r.tablename)
            .sort();
          assert.deepEqual(actual, [...tables, 'auth_sessions', 'refresh_tokens'].sort());
          const columns = (
            await db.query(
              "SELECT table_name, column_name, data_type FROM information_schema.columns WHERE table_schema='public'",
            )
          ).rows;
          for (const table of tables) {
            for (const [column, type] of [
              ['id', 'uuid'],
              ['created_at', 'timestamp with time zone'],
              ['updated_at', 'timestamp with time zone'],
            ]) {
              assert.ok(
                columns.some(
                  (c) => c.table_name === table && c.column_name === column && c.data_type === type,
                ),
                `${table}.${column}`,
              );
            }
            if (!['tenants', 'users'].includes(table))
              assert.ok(
                columns.some(
                  (c) =>
                    c.table_name === table &&
                    c.column_name === 'tenant_id' &&
                    c.data_type === 'uuid',
                ),
              );
          }
        },
      );
      await t.test(
        'all SQL CHECKs, timestamp triggers and search indexes are installed',
        async () => {
          const checks = (
            await db.query(
              "SELECT conname FROM pg_constraint WHERE contype='c' AND connamespace='public'::regnamespace",
            )
          ).rows;
          assert.equal(checks.length, 49);
          assert.ok(checks.some((check) => check.conname === 'ck_purchase_return_confirmation'));
          assert.ok(checks.some((check) => check.conname === 'stock_adjustments_reason_known'));
          assert.ok(checks.some((check) => check.conname === 'ck_purchase_account_platform'));
          assert.ok(checks.some((check) => check.conname === 'ck_purchase_account_alias'));
          assert.ok(checks.some((check) => check.conname === 'ck_po_item_line_no'));
          assert.ok(checks.some((check) => check.conname === 'ck_po_item_freight_allocated'));
          assert.ok(checks.some((check) => check.conname === 'ck_warehouse_remark_length'));
          assert.ok(checks.some((check) => check.conname === 'ck_product_reference_price'));
          assert.ok(checks.some((check) => check.conname === 'ck_product_remark_length'));
          const triggers = (
            await db.query(
              "SELECT tgname FROM pg_trigger WHERE NOT tgisinternal AND tgname LIKE 'tr_%_updated_at'",
            )
          ).rows;
          assert.equal(triggers.length, 23);
          const indexes = (
            await db.query("SELECT indexname FROM pg_indexes WHERE schemaname='public'")
          ).rows.map((r) => r.indexname);
          for (const name of [
            'idx_membership_user',
            'idx_product_search',
            'idx_product_tenant_active_time',
            'idx_po_tenant_status_time',
            'idx_po_platform_order',
            'idx_po_account_date',
            'idx_po_purchase_date',
            'idx_purchase_account_active',
            'idx_po_item_po',
            'idx_pkg_scan',
            'idx_pkg_order',
            'idx_receipt_pkg',
            'idx_stock_product',
            'idx_outbound_status',
            'idx_movement_filter',
            'idx_audit_tenant_time',
          ])
            assert.ok(indexes.includes(name), name);
        },
      );
      const counts = async () =>
        (
          await db.query(`SELECT (SELECT count(*)::int FROM tenants) AS tenants,
      (SELECT count(*)::int FROM users) AS users, (SELECT count(*)::int FROM tenant_memberships) AS memberships,
      (SELECT count(*)::int FROM warehouses) AS warehouses, (SELECT count(*)::int FROM products) AS products`)
        ).rows[0];
      await t.test(
        'Prisma db seed explicitly creates two tenants and related master data',
        async () => {
          await prisma('db', 'seed');
          assert.deepEqual(await counts(), {
            tenants: 2,
            users: 6,
            memberships: 7,
            warehouses: 4,
            products: 6,
          });
          const users = (await db.query('SELECT password_hash, is_active FROM users')).rows;
          assert.ok(
            users.every((u) => /^\$2[ab]\$12\$/.test(u.password_hash) && u.is_active === false),
          );
        },
      );
      await t.test(
        'repeat and concurrent seed preserve IDs, hashes, edits and record counts',
        async () => {
          await db.query(
            "UPDATE products SET name='用户修改的名称' WHERE tenant_id=$1 AND sku='DEMO-CUP'",
            [seedTenants[0].id],
          );
          const before = (
            await db.query('SELECT id, password_hash, updated_at FROM users ORDER BY id')
          ).rows;
          const productIds = (await db.query('SELECT id FROM products ORDER BY id')).rows;
          await prisma('db', 'seed');
          await Promise.all([seedDatabase(testUrl.toString()), seedDatabase(testUrl.toString())]);
          assert.deepEqual(await counts(), {
            tenants: 2,
            users: 6,
            memberships: 7,
            warehouses: 4,
            products: 6,
          });
          assert.deepEqual(
            (await db.query('SELECT id, password_hash, updated_at FROM users ORDER BY id')).rows,
            before,
          );
          assert.deepEqual(
            (await db.query('SELECT id FROM products ORDER BY id')).rows,
            productIds,
          );
          assert.equal(
            (
              await db.query("SELECT name FROM products WHERE tenant_id=$1 AND sku='DEMO-CUP'", [
                seedTenants[0].id,
              ])
            ).rows[0].name,
            '用户修改的名称',
          );
        },
      );
      const a = seedTenants[0].id,
        b = seedTenants[1].id;
      const userA = '03000000-0000-4000-8000-000000000011';
      const userB = '03000000-0000-4000-8000-000000000012';
      const warehouses = (await db.query('SELECT id, tenant_id, code FROM warehouses')).rows;
      const whA = warehouses.find((w) => w.tenant_id === a && w.code === 'MAIN').id;
      const whA2 = warehouses.find((w) => w.tenant_id === a && w.code === 'BACKUP').id;
      const whB = warehouses.find((w) => w.tenant_id === b && w.code === 'MAIN').id;
      const products = (await db.query('SELECT id, tenant_id, sku FROM products')).rows;
      const prodA = products.find((p) => p.tenant_id === a && p.sku === 'DEMO-CUP').id;
      const prodA2 = products.find((p) => p.tenant_id === a && p.sku === 'DEMO-BAG').id;
      const prodB = products.find((p) => p.tenant_id === b && p.sku === 'DEMO-CUP').id;
      const insert = async (table, values) => {
        assert.ok(tables.includes(table));
        const keys = Object.keys(values);
        assert.ok(keys.every((k) => /^[a-z_]+$/.test(k)));
        return (
          await db.query(
            `INSERT INTO "${table}" (${keys.map((k) => `"${k}"`).join(',')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(',')}) RETURNING *`,
            Object.values(values),
          )
        ).rows[0];
      };
      await db.query('BEGIN');
      await insert('purchase_accounts', { tenant_id: a, platform: 'JD', alias: '模型测试采购号' });
      const poData = {
        tenant_id: a,
        warehouse_id: whA,
        order_no: 'TEST-PO-1',
        platform: 'JD',
        created_by: userA,
      };
      const po = await insert('purchase_orders', poData);
      const po2 = await insert('purchase_orders', { ...poData, order_no: 'TEST-PO-2' });
      const poB = await insert('purchase_orders', {
        ...poData,
        tenant_id: b,
        warehouse_id: whB,
        created_by: userB,
      });
      const itemData = {
        tenant_id: a,
        purchase_order_id: po.id,
        product_id: prodA,
        quantity: 10,
        unit_price: '12.34',
        discount_amount: '0.10',
        landed_unit_cost: '12.3401',
      };
      const item = await insert('purchase_order_items', itemData);
      const item2 = await insert('purchase_order_items', {
        ...itemData,
        purchase_order_id: po2.id,
      });
      const pkg = await insert('packages', {
        tenant_id: a,
        purchase_order_id: po.id,
        carrier_code: 'SF',
        tracking_no: 'TEST-TRACK',
      });
      const pkg2 = await insert('packages', { tenant_id: a, purchase_order_id: po2.id });
      const expectedData = {
        tenant_id: a,
        package_id: pkg.id,
        purchase_order_item_id: item.id,
        purchase_order_id: po.id,
        expected_quantity: 5,
      };
      await insert('package_expected_items', expectedData);
      const receiptData = {
        tenant_id: a,
        receipt_no: 'TEST-R-1',
        purchase_order_id: po.id,
        package_id: pkg.id,
        warehouse_id: whA,
        client_operation_id: randomUUID(),
        request_hash: 'a'.repeat(64),
        received_by: userA,
      };
      const receipt = await insert('receipts', receiptData);
      const receiptItemData = {
        tenant_id: a,
        receipt_id: receipt.id,
        purchase_order_item_id: item.id,
        purchase_order_id: po.id,
        product_id: prodA,
        quantity: 3,
        landed_unit_cost: '12.3401',
      };
      const ri = await insert('receipt_items', receiptItemData);
      const supplierReturn = await insert('purchase_returns', {
        tenant_id: a,
        purchase_order_id: po.id,
        warehouse_id: whA,
        return_no: 'MODEL-RETURN',
        reason: '模型约束测试',
        return_date: '2026-10-25',
        created_by: userA,
      });
      const supplierLine = await insert('purchase_return_items', {
        tenant_id: a,
        purchase_return_id: supplierReturn.id,
        purchase_order_id: po.id,
        purchase_order_item_id: item.id,
        product_id: prodA,
        requested_receipt_item_id: ri.id,
        quantity: 1,
        sku_snapshot: 'MODEL',
        name_snapshot: 'model',
        unit_snapshot: '件',
      });
      await insert('purchase_return_allocations', {
        tenant_id: a,
        purchase_return_item_id: supplierLine.id,
        purchase_order_id: po.id,
        purchase_order_item_id: item.id,
        product_id: prodA,
        receipt_item_id: ri.id,
        quantity: 1,
        received_unit_cost: '12.3401',
      });
      const balanceData = {
        tenant_id: a,
        warehouse_id: whA,
        product_id: prodA,
        quantity_on_hand: 3,
        total_cost: '37.0203',
      };
      await insert('stock_balances', balanceData);
      const outData = {
        tenant_id: a,
        warehouse_id: whA,
        outbound_no: 'TEST-OUT-1',
        created_by: userA,
      };
      const out = await insert('outbound_orders', outData);
      const outItemData = {
        tenant_id: a,
        outbound_order_id: out.id,
        product_id: prodA,
        quantity: 2,
      };
      await insert('outbound_order_items', outItemData);
      const adjData = {
        tenant_id: a,
        warehouse_id: whA,
        product_id: prodA,
        quantity_delta: 1,
        reason: 'OTHER',
        unit_cost_snapshot: '12.3401',
        client_operation_id: randomUUID(),
        created_by: userA,
      };
      await insert('stock_adjustments', adjData);
      const moveData = {
        tenant_id: a,
        warehouse_id: whA,
        product_id: prodA,
        source_type: 'RECEIPT',
        source_item_id: ri.id,
        quantity_delta: 3,
        cost_delta: '37.0203',
        quantity_before: 0,
        quantity_after: 3,
        total_cost_before: '0',
        total_cost_after: '37.0203',
        created_by: userA,
      };
      await insert('stock_movements', moveData);
      await insert('audit_logs', {
        tenant_id: a,
        actor_id: userA,
        action: 'TEST',
        object_type: 'receipt',
        object_id: receipt.id,
      });
      const rejected = async (title, code, fn, context = t) =>
        context.test(title, async () => {
          await db.query('SAVEPOINT constraint_case');
          try {
            await assert.rejects(fn, (err) => err.code === code);
          } finally {
            await db.query('ROLLBACK TO SAVEPOINT constraint_case');
            await db.query('RELEASE SAVEPOINT constraint_case');
          }
        });
      await t.test(
        'all 21 business tables accept valid rows; NUMERIC retains exact decimal values',
        async () => {
          for (const table of tables)
            assert.ok(
              (await db.query(`SELECT count(*)::int AS n FROM "${table}"`)).rows[0].n > 0,
              table,
            );
          assert.equal(item.unit_price, '12.34');
          assert.equal(ri.landed_unit_cost, '12.3401');
          const c = (
            await db.query(
              "SELECT numeric_precision,numeric_scale FROM information_schema.columns WHERE table_name='stock_balances' AND column_name='total_cost'",
            )
          ).rows[0];
          assert.deepEqual(c, { numeric_precision: 20, numeric_scale: 4 });
        },
      );
      await rejected('SKU duplicate within tenant', '23505', () =>
        insert('products', { tenant_id: a, sku: 'DEMO-CUP', name: 'duplicate' }),
      );
      await rejected('barcode duplicate within tenant', '23505', () =>
        insert('products', {
          tenant_id: a,
          sku: 'NEW',
          barcode: 'DEMO-690000000001',
          name: 'duplicate',
        }),
      );
      await rejected('empty SKU', '23514', () =>
        insert('products', { tenant_id: a, sku: '   ', name: 'invalid' }),
      );
      await rejected('duplicate tenant membership', '23505', () =>
        insert('tenant_memberships', { tenant_id: a, user_id: userA, role: 'OWNER' }),
      );
      await rejected('unknown membership role', '23514', () =>
        insert('tenant_memberships', { tenant_id: b, user_id: userA, role: 'SUPERUSER' }),
      );
      await rejected('cross tenant warehouse on purchase order', '23503', () =>
        insert('purchase_orders', { ...poData, order_no: 'BAD', warehouse_id: whB }),
      );
      await rejected('creator without tenant membership', '23503', () =>
        insert('purchase_orders', { ...poData, order_no: 'BAD', created_by: userB }),
      );
      await rejected('cross tenant product on purchase item', '23503', () =>
        insert('purchase_order_items', { ...itemData, product_id: prodB }),
      );
      await rejected('cross tenant order on purchase item', '23503', () =>
        insert('purchase_order_items', { ...itemData, purchase_order_id: poB.id }),
      );
      await rejected('duplicate SKU in purchase order', '23505', () =>
        insert('purchase_order_items', itemData),
      );
      for (const [label, changes] of [
        ['zero quantity', { quantity: 0 }],
        ['negative price', { unit_price: '-1' }],
        ['excess discount', { discount_amount: '999' }],
        ['negative cost', { landed_unit_cost: '-1' }],
      ])
        await rejected(`purchase item ${label}`, '23514', () =>
          insert('purchase_order_items', { ...itemData, product_id: prodA2, ...changes }),
        );
      await rejected('unknown purchase status', '23514', () =>
        insert('purchase_orders', { ...poData, order_no: 'BAD', status: 'INVALID' }),
      );
      await rejected('negative freight', '23514', () =>
        insert('purchase_orders', { ...poData, order_no: 'BAD', freight_amount: '-1' }),
      );
      await rejected('duplicate carrier tracking in tenant', '23505', () =>
        insert('packages', {
          tenant_id: a,
          purchase_order_id: po.id,
          carrier_code: 'SF',
          tracking_no: 'TEST-TRACK',
        }),
      );
      await rejected('carrier without tracking', '23514', () =>
        insert('packages', { tenant_id: a, purchase_order_id: po.id, carrier_code: 'SF' }),
      );
      await rejected('package expected line from another order', '23503', () =>
        insert('package_expected_items', { ...expectedData, purchase_order_item_id: item2.id }),
      );
      await rejected('receipt package from another order', '23503', () =>
        insert('receipts', {
          ...receiptData,
          receipt_no: 'BAD',
          client_operation_id: randomUUID(),
          package_id: pkg2.id,
        }),
      );
      await rejected('receipt destination differs from order', '23503', () =>
        insert('receipts', {
          ...receiptData,
          receipt_no: 'BAD',
          client_operation_id: randomUUID(),
          warehouse_id: whA2,
        }),
      );
      await rejected('receipt operation duplicate', '23505', () =>
        insert('receipts', { ...receiptData, receipt_no: 'OTHER' }),
      );
      await rejected('receipt item from another order', '23503', () =>
        insert('receipt_items', { ...receiptItemData, purchase_order_item_id: item2.id }),
      );
      await rejected('receipt item product differs from purchased line', '23503', () =>
        db.query('UPDATE receipt_items SET product_id=$1 WHERE id=$2', [prodA2, ri.id]),
      );
      await rejected('zero package expected quantity', '23514', () =>
        db.query('UPDATE package_expected_items SET expected_quantity=0 WHERE package_id=$1', [
          pkg.id,
        ]),
      );
      await rejected('unknown package status', '23514', () =>
        db.query("UPDATE packages SET status='INVALID' WHERE id=$1", [pkg.id]),
      );
      await rejected('unconfirmed receipt status', '23514', () =>
        db.query("UPDATE receipts SET status='DRAFT' WHERE id=$1", [receipt.id]),
      );
      await rejected('zero receipt quantity', '23514', () =>
        db.query('UPDATE receipt_items SET quantity=0 WHERE id=$1', [ri.id]),
      );
      await rejected('negative receipt cost', '23514', () =>
        db.query('UPDATE receipt_items SET landed_unit_cost=-1 WHERE id=$1', [ri.id]),
      );
      await rejected('negative balance quantity', '23514', () =>
        db.query('UPDATE stock_balances SET quantity_on_hand=-1 WHERE tenant_id=$1', [a]),
      );
      await rejected('negative balance cost', '23514', () =>
        db.query('UPDATE stock_balances SET total_cost=-1 WHERE tenant_id=$1', [a]),
      );
      await rejected('duplicate stock key', '23505', () => insert('stock_balances', balanceData));
      await rejected('cross tenant stock product', '23503', () =>
        insert('stock_balances', { ...balanceData, product_id: prodB }),
      );
      await rejected('cross tenant outbound product', '23503', () =>
        insert('outbound_order_items', { ...outItemData, product_id: prodB }),
      );
      await rejected('shipped order without confirmation metadata', '23514', () =>
        db.query("UPDATE outbound_orders SET status='SHIPPED' WHERE id=$1", [out.id]),
      );
      await rejected('zero outbound quantity', '23514', () =>
        insert('outbound_order_items', { ...outItemData, product_id: prodA2, quantity: 0 }),
      );
      await rejected('negative outbound unit cost', '23514', () =>
        insert('outbound_order_items', {
          ...outItemData,
          product_id: prodA2,
          shipped_unit_cost: '-1',
        }),
      );
      await rejected('cross tenant outbound warehouse', '23503', () =>
        insert('outbound_orders', { ...outData, outbound_no: 'BAD', warehouse_id: whB }),
      );
      await rejected('unknown outbound status', '23514', () =>
        insert('outbound_orders', { ...outData, outbound_no: 'BAD', status: 'INVALID' }),
      );
      await rejected('duplicate adjustment operation', '23505', () =>
        insert('stock_adjustments', adjData),
      );
      await rejected('zero adjustment', '23514', () =>
        insert('stock_adjustments', {
          ...adjData,
          client_operation_id: randomUUID(),
          quantity_delta: 0,
        }),
      );
      await rejected('negative adjustment cost', '23514', () =>
        insert('stock_adjustments', {
          ...adjData,
          client_operation_id: randomUUID(),
          unit_cost_snapshot: '-1',
        }),
      );
      await rejected('unknown adjustment reason', '23514', () =>
        insert('stock_adjustments', {
          ...adjData,
          client_operation_id: randomUUID(),
          reason: 'constraint test',
        }),
      );
      await rejected('cross tenant adjustment product', '23503', () =>
        insert('stock_adjustments', {
          ...adjData,
          client_operation_id: randomUUID(),
          product_id: prodB,
        }),
      );
      await rejected('duplicate movement source', '23505', () =>
        insert('stock_movements', moveData),
      );
      await rejected('movement quantity equation', '23514', () =>
        insert('stock_movements', { ...moveData, source_item_id: randomUUID(), quantity_after: 5 }),
      );
      await rejected('movement cost equation', '23514', () =>
        insert('stock_movements', {
          ...moveData,
          source_item_id: randomUUID(),
          total_cost_after: '38',
        }),
      );
      await rejected('unknown movement source', '23514', () =>
        insert('stock_movements', {
          ...moveData,
          source_item_id: randomUUID(),
          source_type: 'INVALID',
        }),
      );
      await rejected('negative movement balance', '23514', () =>
        insert('stock_movements', {
          ...moveData,
          source_item_id: randomUUID(),
          quantity_before: -4,
          quantity_after: -1,
        }),
      );
      await rejected('cross tenant movement product', '23503', () =>
        insert('stock_movements', { ...moveData, source_item_id: randomUUID(), product_id: prodB }),
      );
      await rejected('cross tenant audit actor', '23503', () =>
        insert('audit_logs', { tenant_id: a, actor_id: userB, action: 'BAD', object_type: 'test' }),
      );
      await rejected('referenced product cannot be deleted', '23503', () =>
        db.query('DELETE FROM products WHERE id=$1', [prodA]),
      );
      await t.test(
        'same SKU/barcode/order number/tracking across tenants and nullable barcodes are allowed',
        async () => {
          assert.equal(products.filter((p) => p.sku === 'DEMO-CUP').length, 2);
          await insert('packages', {
            tenant_id: b,
            purchase_order_id: poB.id,
            carrier_code: 'SF',
            tracking_no: 'TEST-TRACK',
          });
          await insert('products', { tenant_id: a, sku: 'NULL-1', name: 'null barcode' });
          await insert('products', { tenant_id: a, sku: 'NULL-2', name: 'null barcode' });
          assert.equal(po.order_no, poB.order_no);
        },
      );
      await t.test(
        'outbound operation unique within a tenant and nullable on drafts',
        async (sub) => {
          const operation = randomUUID();
          await db.query('UPDATE outbound_orders SET confirm_operation_id=$1 WHERE id=$2', [
            operation,
            out.id,
          ]);
          await rejected(
            'outbound confirmation duplicate',
            '23505',
            () =>
              insert('outbound_orders', {
                ...outData,
                outbound_no: 'DUPLICATE',
                confirm_operation_id: operation,
              }),
            sub,
          );
          await insert('outbound_orders', {
            tenant_id: b,
            warehouse_id: whB,
            outbound_no: 'TEST-OUT-1',
            created_by: userB,
            confirm_operation_id: operation,
          });
          await insert('outbound_orders', { ...outData, outbound_no: 'DRAFT-2' });
          await insert('outbound_orders', { ...outData, outbound_no: 'DRAFT-3' });
        },
      );
      await t.test('database trigger updates timestamp for SQL changes', async () => {
        const before = (await db.query('SELECT updated_at FROM products WHERE id=$1', [prodA]))
          .rows[0].updated_at;
        await db.query("UPDATE products SET specification='updated' WHERE id=$1", [prodA]);
        const after = (await db.query('SELECT updated_at FROM products WHERE id=$1', [prodA]))
          .rows[0].updated_at;
        assert.ok(after.getTime() > before.getTime());
      });
      await db.query('ROLLBACK');
      await t.test('transaction rollback leaves no business documents or stock', async () => {
        assert.equal(
          (await db.query('SELECT count(*)::int AS n FROM stock_balances')).rows[0].n,
          0,
        );
        assert.equal(
          (await db.query('SELECT count(*)::int AS n FROM purchase_orders')).rows[0].n,
          0,
        );
      });
      await t.test('concurrent unique SKU inserts allow exactly one winner', async () => {
        const one = new Client({ connectionString: testUrl.toString() });
        const two = new Client({ connectionString: testUrl.toString() });
        try {
          await Promise.all([one.connect(), two.connect()]);
          const query =
            "INSERT INTO products(tenant_id,sku,name) VALUES($1,'CONCURRENT','concurrent test')";
          const results = await Promise.allSettled([one.query(query, [a]), two.query(query, [a])]);
          assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
          assert.equal(results.find((r) => r.status === 'rejected').reason.code, '23505');
        } finally {
          await Promise.all([one.end(), two.end()]);
        }
      });
      await t.test('Prisma model and applied database have no structural drift', async () => {
        await prisma(
          'migrate',
          'diff',
          '--from-config-datasource',
          '--to-schema',
          'prisma/schema.prisma',
          '--exit-code',
        );
      });
    } finally {
      if (db) await db.end();
      // Only dispose the random database created by this run. Never reset/drop caicang or its volume.
      if (created) await admin.query(`DROP DATABASE "${databaseName}"`);
      await admin.end();
    }
  },
);
