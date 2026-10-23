# 任务 28 报告 — 精简商品管理字段

## 一、结论

商品建档回到业务真正要填的六项：**商品货号、颜色、尺码、SKU、参考进货价、商品名称（选填）**。条码、规格、单位、备注、启用状态收进「高级选项」，单位默认“件”，**全表只有 SKU 一个硬性必填项**。名称留空时由服务端按 `货号 颜色 尺码` 生成（三者都空则用 SKU），不会出现空名称。

验收在真实 PostgreSQL + 真实 API 上跑通：**T20 货号建两个变体（黑色 L / T20-BLK-L、白色 XL / T20-WHT-XL）→ 同一张采购单分别买 5 件 @9.90、3 件 @20.00 → 入库后两条库存余额各 5/3、均价各 9.9000/20.0000 → 出库 2 件黑 + 1 件白，余额变 3/2、流水按 SKU 分开 → 之后把黑色参考价改成 99.00、颜色改成深黑，入库成本、采购行快照、出库成本一个字都没变**。

## 二、要求对照

| #   | 要求                                               | 实现                                                                                                                                              | 对应测试                                                                                  |
| --- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| 1   | 主要字段：货号、颜色、SKU、尺码、参考进货价        | 表单主区域按这个顺序排：货号 / 颜色 / 尺码 / SKU / 参考进货价 / 名称（选填），六项占两列网格                                                      | `scripts/web-catalog.test.mjs` 表单校验用例、`scripts/product-variants.test.mjs` 变体用例 |
| 2   | 条码不再作为主要录入字段                           | 条码移入「高级选项」，仍可空、仍保留同商家唯一与非空唯一约束；列表不再显示条码列                                                                  | `SKU barcode text and decimal validation…`、`PRODUCT_BARCODE_ALREADY_EXISTS` 用例         |
| 3   | 单位默认“件”，减少不必要必填                       | `blankProduct()` 单位默认 `件`；`productErrors` 只剩 SKU、单位两条必填校验，名称/条码/规格/备注长度超限才报错                                     | `empty forms require SKU and unit but let the name be generated…`                         |
| 4   | 列表清晰展示货号、颜色、SKU、尺码、参考进货价      | 列顺序：商品货号（空则显示名称，下面补自定义名称/规格）/ 颜色 / 尺码 / SKU 编码 / 单位 / 参考进货价（元）/ 状态 / 操作                            | 前端静态断言与生产构建                                                                    |
| 5   | 同款不同颜色或尺码可用不同 SKU                     | 三个属性与 SKU 相互独立，没有任何“同货号同 SKU”的约束；名称由属性派生                                                                             | `the same 货号 keeps a separate SKU per 颜色/尺码…`                                       |
| 6   | 同一商家内 SKU 必须唯一                            | 沿用 `products_tenant_sku_key` 唯一索引；接口 409 `PRODUCT_SKU_ALREADY_EXISTS`，另一商家可用同编码                                                | 同上用例：同商家重复 409、B 商家 201                                                      |
| 7   | 参考进货价只是参考值，不覆盖历史实际价格与成本快照 | 参考价只在 `products.reference_purchase_price`；采购 `unit_price`、`landed_unit_cost`、入库 `landed_unit_cost`、出库 `shipped_unit_cost` 各自独立 | `editing 参考进货价 or the variant attributes never rewrites historical cost`             |
| 8   | 检查 Product 模型、采购快照、扫码查询、库存与出库  | 名称不再必填但派生后仍非空，库存/出库按 `sku` 识别不变；采购/入库/出库展示走 `nameSnapshot ?? product.name`；`lookup?code=` 仍按 SKU/条码精确匹配 | `SKU and barcode lookup return the right variant…`、出库与库存用例                        |
| 9   | 不删字段、不重建库，旧数据兼容                     | **本次没有新迁移**：货号/颜色/尺码在任务 27 已加为可空列，条码本就可空；只改必填性与界面                                                          | 迁移目录无新增；全量 `pnpm test` 迁移漂移检查保持“No difference detected”                 |

## 三、新增与修改文件

新增：

- `apps/api/src/modules/products/product-name.ts`：`derivedProductName()`，货号/颜色/尺码拼名称、全空回落 SKU
- `scripts/product-variants.test.mjs`：变体全链路验收
- `docs/TASK_28_REPORT.md`

修改：

- `apps/api/src/modules/products/product.dto.ts`：`CreateProductDto.name` 改为可选（`ApiPropertyOptional` + `ValidateIf(present)`，允许空串）；更新 `UpdateProductDto.name` 说明（空串=改回自动）；`ProductListQueryDto.search` 描述补货号/颜色/尺码
- `apps/api/src/modules/products/products.service.ts`：创建时无名称则派生；更新时“原名为自动生成才随属性重算，自定义名称不覆盖，空串强制回到自动”
- `apps/admin-web/src/api/catalog-form.ts`：`productErrors` 只保留 SKU/单位必填；新增 `previewProductName()` 供表单实时预览
- `apps/admin-web/src/components/ProductEditor.vue`：主区域六字段 + 高级选项折叠；编辑自动命名商品时名称框留空；高级选项字段报错自动展开；名称实时预览
- `apps/admin-web/src/views/ProductsView.vue`：列改为 货号/颜色/尺码/SKU/单位/参考进货价/状态；搜索占位符补货号、颜色、尺码
- `apps/admin-web/src/views/ProductDetailView.vue`：详情补货号/颜色/尺码，顺序按业务字段重排
- `apps/admin-web/src/main.ts`：注册 `ElCollapse` / `ElCollapseItem`
- `apps/admin-web/src/catalog.css`：高级选项折叠区与名称预览样式
- `scripts/products.test.mjs`：`name` 从必填断言中移除；新增“名称为可选并按属性自动生成”用例；搜索用例扩到货号/颜色/尺码；OpenAPI 断言改为“name 不在 required”
- `scripts/web-catalog.test.mjs`：空表单错误断言改为 `['sku','unit']`；新增 `previewProductName` 断言
- `package.json`：新增 `test:variants`，并纳入 `pnpm test`
- `docs/PRODUCTS.md`、`docs/WEB_CATALOG.md`、`docs/API_SPEC.md`：字段规则、名称派生、列表列说明

## 四、关键设计

**为什么让名称派生，而不是继续必填。** 用户填的真实信息是“哪个货号的什么颜色什么尺码”，名称只是给人看的标签。强制填名称等于让人把属性再抄一遍，还容易抄错；派生出来的 `T20 黑色 L` 既能读，也天然跟属性一致。想写营销名或简称仍然可以自己填。

**自动与自定义怎么区分。** 服务端在 PATCH 时比较“当前名称是否等于当时的派生结果”：相等说明没人改过，改属性就同步重算；不相等说明是用户起的名字，绝不覆盖。显式传空字符串是唯一的“改回自动”入口。这样既不会因为改颜色把“黑标经典款”冲掉，也不会让自动名一直停在旧属性上。

**表单里也把这件事显式化。** 编辑一个自动命名的商品时，名称框留空、下面一行实时显示“名称留空时使用：T20 黑色 L”，用户一眼能看懂规则；填了字就按填的存。

**为什么没有新迁移。** 货号/颜色/尺码在任务 27 已经作为可空列加过（`20261023130000_product_attributes`），条码本来就是可空列。本次只改 DTO 的必填性、服务端的名称派生和界面布局，数据库结构无变化，所以既不删字段也不重建库，旧数据（名称为空字符串的历史行）读出来仍然正常。

**参考价为什么不进成本。** 参考价是“下次采购大概多少钱”的备忘。真实成本来自采购单 `unit_price` 与运费/优惠分摊后的 `landed_unit_cost`，入库时写进 `receipt_items.landed_unit_cost` 与库存成本池，出库时快照成 `shipped_unit_cost`。测试里把参考价从 10.00 改成 99.00，三处历史成本都没动。

## 五、验证结果

| 命令 | 真实结果 |
|---|---|
| `pnpm typecheck` | 通过（api-contract、utils、api、admin-web、mobile 全部无错） |
| `pnpm build` | 通过，api / admin-web / mobile 全部产出 |
| `pnpm lint`（`--max-warnings 0`） | 通过，无输出 |
| `pnpm format:check` | `All matched files use Prettier code style!` |
| `pnpm test:variants` | **8 通过 / 0 失败 / 0 跳过** |
| `pnpm test`（全仓） | **614 通过 / 0 失败 / 0 跳过，7 分 37 秒** |
| 迁移漂移检查 | 临时库 `migrate deploy` 后跑 `migrate diff --from-config-datasource --to-schema`，输出 `-- This is an empty migration.`；本次确实没有新增迁移 |

`scripts/product-variants.test.mjs` 的六个用例：

1. `the same 货号 keeps a separate SKU per 颜色/尺码 and auto-names both variants`：两个变体名称分别为 `T20 黑色 L` / `T20 白色 XL`，单位默认 `件`，条码为 null；同商家同 SKU 409，B 商家同 SKU 201。
2. `SKU and barcode lookup return the right variant while 货号 search returns the family`：`lookup?code=T20-BLK-L` 只命中黑色，条码 6900000000027 只命中白色，搜 `T20` 命中两个，搜 `白色` 只命中一个。
3. `one purchase order buys 5 black and 3 white at their own real prices`：一张采购单两行，货号/颜色/尺码/名称快照逐行正确，单价 9.90 / 20.00，入库成本 9.9000 / 20.0000，参考价仍是 10.00 / 12.00。
4. `stock is kept per variant with its own average cost`：余额 5 件 49.5000 与 3 件 60.0000，`/inventory/balances` 两行 SKU 与均价各自独立。
5. `outbound ships the 黑色 L and 白色 XL variants separately`：出库 2 + 1 后剩 3 / 2，成本 19.80 / 20.00，流水按 SKU 各一条。
6. `editing 参考进货价 or the variant attributes never rewrites historical cost`：参考价改 99.00、颜色改深黑后，`receipt_items`、`purchase_order_items`、`outbound_order_items` 的历史成本与快照全部原值。

说明：全量 `pnpm test` 之后再补了一处纯界面调整（编辑自动命名商品时名称框留空、列表副标题避免与主标题重复），随后重新跑了 `vue-tsc`、admin-web 生产构建、`web-catalog`（24 通过）与 `web-session`（25 通过），都通过；业务逻辑与接口在此之后没有再改。

## 六、边界与未做

- 库存余额与流水接口仍只给 `sku`/`name`，没有单独返回货号/颜色/尺码三列；变体靠 SKU 与派生名称区分。若以后要在库存页做“按货号汇总”，需要给 `inventory` DTO 加字段（纯读，不影响账）。
- 商品列表页没有按货号/颜色/尺码做结构化筛选，只提供统一搜索框（服务端支持字面匹配）。多条件组合筛选属于后续增强。
- 条码仍是“非空即唯一”，没有做“同款多尺码共用一个条码”的特殊处理；扫码仍按 SKU/条码精确命中，同码跨商品时返回多个候选由客户端选择。
- 没有删除任何字段，历史上名称为空字符串的商品不会被批量回填成派生名（保持原样），需要时在编辑页保存一次即可。
