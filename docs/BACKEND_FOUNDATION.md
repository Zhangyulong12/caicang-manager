# 后端公共基础模块

## 本地启动与检查

```powershell
cd D:\Dev\caicang-manager
pnpm install --frozen-lockfile
pnpm db:up
pnpm prisma:migrate:deploy
pnpm start:api
```

另开终端运行 `pnpm api:check`。健康接口 `http://localhost:3000/api/v1/health` 真实查询 PostgreSQL。开发 Swagger 为 `http://localhost:3000/api/docs`，原始规范 `/api/docs-json`。

```powershell
pnpm lint
pnpm format:check
pnpm typecheck
pnpm test:api
pnpm test
pnpm test:db
```

`test:api` 编译真实应用与独立测试根模块，启动临时端口进行 HTTP 测试；测试根模块额外提供 DTO/分页/异常/限流夹具，生产 AppModule 不引用它。`pnpm test` 先构建 API/Web/手机 H5，再运行公共模块与原有冒烟测试。`test:db` 实际停启本地数据库，不要与依赖数据库的测试并发执行。

## 新模块的写法

1. 模块加入 AppModule，自动继承 CommonModule 的验证/异常/响应/限流，以及身份→商家→角色全局 Guard；公开接口须显式 Public，全局账号操作须显式 GlobalAccount。商家业务显式 TenantEndpoint/Roles/RequirePermissions，使用 CurrentTenant 和 TenantContextService 事务检查，不再创建独立错误格式或 response.json。未声明权限默认拒绝。
2. 请求用 DTO 类。字符串加 IsString 等装饰器；嵌套 DTO 配 Type/ValidateNested；金额保持字符串。关闭隐式转换，分页查询继承 PaginationQueryDto。不要把传入 tenantId 当认证上下文。
3. 控制器返回原始数据；分页返回 PageResult(items,{page,pageSize,total})。拦截器生成 data/requestId，原 HTTP 状态保留，undefined 数据变为 null。不得手工再套 envelope。
4. 使用 BusinessException('OUT_OF_STOCK',{available:2}) 等注册错误码；新增码同时维护 api-contract、ERRORS、API 文档和测试。未在注册表中的任意异常统一 INTERNAL_ERROR。仅允许安全业务详情，不传入异常、请求或数据库对象。
5. Swagger 用 ApiDataResponse(OutputDto,201)、ApiPageResponse(RowDto) 或 ApiArrayResponse(RowDto,maxItems) 描述包装；输出 DTO 仍需 ApiProperty。数组/分页基类只定义 requestId，不把 data 同时约束为 object 与 array。bootstrap 自动附加公共错误和 requestId 参数；当前 health 保持兼容已有 HealthResponseDto。
6. 登录/注册及任务 06 refresh/logout 已加 SensitiveRateLimit。限流为每路由/IP 规则；账号维度锁定和多实例共享存储仍是后续范围。
7. 注入 SafeLogger，不用 console 打印业务输入或错误。自由文本和异常默认不记录，请求日志只接受必要元数据字段。错误响应详情支持递归敏感字段遮蔽，但仍不能用任意异常原文作为公共详情。

## 配置

| 变量 | 开发默认 | 校验/生产行为 |
| --- | --- | --- |
| NODE_ENV | development | 仅 development/test/production |
| DATABASE_URL | 必填 | PostgreSQL URL，需主机、用户、密码、数据库；错误只报变量名 |
| API_PORT | 3000 | 1–65535 整数 |
| API_HOST | 0.0.0.0 | 明确 IPv4/IPv6 地址 |
| WEB_ORIGIN | localhost:5173、5174 的 HTTP origins | 逗号分隔精确 origin，无通配符/路径/末尾斜杠；生产必填且 HTTPS |
| SWAGGER_ENABLED | true | 仅 true/false；生产默认 false 且禁止 true |
| RATE_LIMIT_LIMIT | 120 | 1–10000，每路由/IP |
| RATE_LIMIT_TTL_MS | 60000 | 1–3600000 毫秒 |
| API_BODY_LIMIT_KB | 64 | 1–1024 KiB，JSON 解析上限 |
| TRUSTED_PROXIES | 空 | 默认不信任转发头；仅 IP/CIDR，非 0 前缀，不接受 true 或跳数 |
| JWT_ACCESS_SECRET | 首次开发启动生成忽略的 .env.auth.local | 至少 32 字节，拒绝示例占位值；生产必须由进程环境注入 |
| JWT_ACCESS_TTL_SECONDS | 900 | 60–900 秒，验证签名、有效期、issuer/audience 和令牌类型 |
| REFRESH_TOKEN_TTL_SECONDS | 604800 | 3600–2592000 秒；数据库会话绝对有效期，刷新不延长 |

开发/测试读取根 .env，进程环境优先；缺少 JWT_ACCESS_SECRET 时只创建一次 .env.auth.local（随机 48 字节转 hex），重复启动只读取，不覆盖原密钥或 .env。生产必须在进程中显式设置 NODE_ENV=production，且只接受进程环境、不读/生成本地密钥文件；不允许靠本地 .env 切换到生产模式。根 .env.example 是开发示例，不能原样当生产配置。外部 HTTPS/TLS 留待后续部署任务。

CORS 允许 API 自身同源请求（含 Swagger POST）和原生无 Origin 请求；其他浏览器来源必须精确匹配白名单，支持认证和业务 JSON 写入所需预检头，不启用跨域 cookie。CORS 和限流不替代 JWT、成员身份或角色验证。

限流使用单进程内存，进程重启清零；多 API 实例上线前换共享存储。反向代理必须只允许可信入口并配置准确 TRUSTED_PROXIES；不能直接信任公网传入的 X-Forwarded-For。

响应示例、错误码和日志规则以 `API_SPEC.md` 为准。实际执行与未实现范围见 `TASK_04_REPORT.md`。

任务 09 的 WarehousesModule 沿用公共 DTO 校验、成功分页响应、异常/错误码、requestId、安全日志及 Guard/租户事务。新增 WAREHOUSE_CODE_ALREADY_EXISTS 对应标准 409；不另造仓库专用响应或错误格式。仓库创建原子写审计，名称、备注与完整地址不进入应用日志，详见 WAREHOUSES.md。
