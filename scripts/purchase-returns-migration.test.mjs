import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { cp, mkdir, readdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { test } from 'node:test';
const { Client } = createRequire(new URL('../apps/api/package.json', import.meta.url))('pg');
const run = promisify(execFile);
loadEnvFile(new URL('../.env', import.meta.url));

test(
  'supplier return migration upgrades nine-migration receipt/stock data without rewriting it',
  { timeout: 120000 },
  async () => {
    const source = new URL(process.env.DATABASE_URL);
    assert.equal(source.pathname, '/caicang');
    assert.ok(['localhost', '127.0.0.1'].includes(source.hostname));
    const name = 'caicang_test_' + randomUUID().replaceAll('-', '');
    const url = new URL(source);
    url.pathname = '/' + name;
    const admin = new Client({ connectionString: source.toString() }),
      db = new Client({ connectionString: url.toString() });
    let created = false,
      connected = false;
    try {
      await admin.connect();
      assert.match(name, /^caicang_test_[a-f0-9]{32}$/);
      await admin.query(`CREATE DATABASE "${name}"`);
      created = true;
      const root = new URL(
        '../apps/api/.test-build/return-upgrade-' + randomUUID() + '/',
        import.meta.url,
      );
      await mkdir(new URL('migrations/', root), { recursive: true });
      for (const entry of await readdir(
        new URL('../apps/api/prisma/migrations/', import.meta.url),
        { withFileTypes: true },
      )) {
        if (entry.isDirectory() && entry.name >= '20261025090000_purchase_returns') continue;
        await cp(
          new URL('../apps/api/prisma/migrations/' + entry.name, import.meta.url),
          new URL('migrations/' + entry.name, root),
          { recursive: true },
        );
      }
      const config = new URL('prisma.config.mjs', root);
      await writeFile(
        config,
        `export default {schema:${JSON.stringify(fileURLToPath(new URL('../apps/api/prisma/schema.prisma', import.meta.url)))},migrations:{path:${JSON.stringify(fileURLToPath(new URL('migrations/', root)))}},datasource:{url:process.env.DATABASE_URL}};`,
      );
      const migrate = (...args) =>
        run(
          process.execPath,
          [
            fileURLToPath(
              new URL('../apps/api/node_modules/prisma/build/index.js', import.meta.url),
            ),
            'migrate',
            'deploy',
            ...args,
          ],
          {
            cwd: fileURLToPath(new URL('../apps/api/', import.meta.url)),
            env: { ...process.env, DATABASE_URL: url.toString() },
            windowsHide: true,
            timeout: 60000,
          },
        );
      await migrate('--config', fileURLToPath(config));
      await db.connect();
      connected = true;
      assert.equal(
        (
          await db.query(
            'SELECT count(*)::int AS n FROM _prisma_migrations WHERE finished_at IS NOT NULL',
          )
        ).rows[0].n,
        9,
      );
      const tables = [];
      async function insert(table, data) {
        assert.match(table, /^[a-z_]+$/);
        const keys = Object.keys(data);
        assert.ok(keys.every((k) => /^[a-z_]+$/.test(k)));
        tables.push(table);
        return (
          await db.query(
            `INSERT INTO ${table}(${keys.join(',')}) VALUES(${keys.map((_, i) => '$' + (i + 1)).join(',')}) RETURNING *`,
            Object.values(data),
          )
        ).rows[0];
      }
      const tenant = await insert('tenants', { name: '退货升级测试' });
      const user = await insert('users', {
        email: 'legacy-return@example.test',
        password_hash: 'inactive-fixture',
        display_name: '旧用户',
        is_active: false,
      });
      await insert('tenant_memberships', { tenant_id: tenant.id, user_id: user.id, role: 'OWNER' });
      const wh = await insert('warehouses', {
        tenant_id: tenant.id,
        code: 'LEGACY',
        name: '旧仓库',
      });
      const p = await insert('products', {
        tenant_id: tenant.id,
        sku: 'LEGACY-SKU',
        name: '旧商品',
      });
      const po = await insert('purchase_orders', {
        tenant_id: tenant.id,
        warehouse_id: wh.id,
        order_no: 'LEGACY-PO',
        platform: 'TAOBAO',
        status: 'RECEIVED',
        created_by: user.id,
      });
      const item = await insert('purchase_order_items', {
        tenant_id: tenant.id,
        purchase_order_id: po.id,
        product_id: p.id,
        quantity: 10,
        unit_price: '18.50',
        landed_unit_cost: '18.5000',
      });
      const pkg = await insert('packages', {
        tenant_id: tenant.id,
        purchase_order_id: po.id,
        carrier_code: 'SF',
        tracking_no: '000LEGACY',
      });
      const receipt = await insert('receipts', {
        tenant_id: tenant.id,
        purchase_order_id: po.id,
        package_id: pkg.id,
        warehouse_id: wh.id,
        receipt_no: 'LEGACY-R',
        client_operation_id: randomUUID(),
        request_hash: 'a'.repeat(64),
        received_by: user.id,
      });
      const ri = await insert('receipt_items', {
        tenant_id: tenant.id,
        receipt_id: receipt.id,
        purchase_order_item_id: item.id,
        purchase_order_id: po.id,
        product_id: p.id,
        quantity: 10,
        landed_unit_cost: '18.5000',
      });
      await insert('stock_balances', {
        tenant_id: tenant.id,
        warehouse_id: wh.id,
        product_id: p.id,
        quantity_on_hand: 10,
        total_cost: '185.0000',
      });
      await insert('stock_movements', {
        tenant_id: tenant.id,
        warehouse_id: wh.id,
        product_id: p.id,
        source_type: 'RECEIPT',
        source_item_id: ri.id,
        quantity_delta: 10,
        cost_delta: '185.0000',
        quantity_before: 0,
        quantity_after: 10,
        total_cost_before: '0.0000',
        total_cost_after: '185.0000',
        created_by: user.id,
      });
      const before = new Map();
      for (const table of tables)
        before.set(
          table,
          (await db.query(`SELECT row_to_json(r) AS data FROM ${table} r ORDER BY id`)).rows,
        );
      await migrate();
      await migrate();
      for (const table of tables)
        assert.deepEqual(
          (await db.query(`SELECT row_to_json(r) AS data FROM ${table} r ORDER BY id`)).rows,
          before.get(table),
          table + ' must be unchanged',
        );
      for (const table of [
        'purchase_returns',
        'purchase_return_items',
        'purchase_return_allocations',
      ])
        assert.equal((await db.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n, 0);
      assert.equal(
        (
          await db.query(
            'SELECT count(*)::int AS n FROM _prisma_migrations WHERE finished_at IS NOT NULL',
          )
        ).rows[0].n,
        10,
      );
    } finally {
      if (connected) await db.end();
      if (created) {
        await admin.query(
          'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()',
          [name],
        );
        await admin.query(`DROP DATABASE "${name}"`);
      }
      await admin.end();
    }
  },
);
