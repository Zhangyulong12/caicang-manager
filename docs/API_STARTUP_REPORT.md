# NestJS API 启动失败排查与修复（2026-10-23）

项目：`D:\Dev\caicang-manager`。本次仅修复启动诊断与当前进程冲突，不开发业务功能，不提交或推送。

## 1. 确认的根因

实际异常是 **EADDRINUSE，3000 端口已被旧 API 占用**：

```text
Error: listen EADDRINUSE: address already in use 0.0.0.0:3000
    at Server.setupListenHandle [as _listen2] (node:net:1940:16)
    at listenInCluster (node:net:1997:12)
    at node:net:2206:7
    at process.processTicksAndRejections (node:internal/process/task_queues:89:21)
```

排查时原监听者为 PID **52848**，命令行为 `"D:\nodejs\node.exe" apps/api/dist/main.js`，启动时间 2026-10-23 14:51:32。它是前次复核时启动并保留的 API；当时的健康接口依然 HTTP 200，因此新实例不能再次监听同一个端口。这是遗留进程的启动管理问题，不是数据库不可用。

没有预先据端口占用猜测结论：先用原代码重新执行入口，得到退出码 1 与通用 `API startup failed`；加入脱敏诊断、重新构建后，在旧实例尚未停止时再次执行入口，实际捕获上方 EADDRINUSE、code 和完整 Node 堆栈。随后才停止已核实的旧进程并验证重启。

检查到 Docker/PostgreSQL healthy；`PrismaService.onModuleInit()` 的 `$connect()` 已完成，Nest 应用初始化已到达 listen。当前注册模块的 DI、应用初始化钩子、环境验证没有在此次复现中失败。没有为了启动而删除模块、改密码、忽略异常、切换端口或关闭安全检查。

## 2. 之前为什么看不到具体错误

1. `apps/api/src/common/logging.ts` 的 SafeLogger.error 原本忽略 `_message` 和 `_stack`，只保留 level/event/context；RouterExplorer、RoutesResolver、NestApplication 等框架日志也只显示 context。
2. `apps/api/src/main.ts` 的 catch 只允许 `Invalid configuration: <字段名>`，其余一律替换成 API startup failed，原 Error 被丢弃。
3. GlobalExceptionFilter 面向 HTTP 请求；此处是监听前的启动失败，不会经过 HTTP 过滤器。
4. `Failed running 'dist/main.js'. Waiting for file changes before restarting...` 是 Node watch 模式在子进程非零退出后的结果，不是底层原因。

## 3. 最小修改

| 文件 | 改动 |
| --- | --- |
| apps/api/src/main.ts | catch 调用启动专用安全格式化函数；仍写 stderr 并以 1 退出 |
| apps/api/src/common/logging.ts | 新增 formatBootstrapFailure；原 SafeLogger 请求/框架日志行为保持不变 |
| scripts/api-foundation.test.mjs | 开发诊断脱敏、生产无堆栈、非 Error/循环 cause/异常 Unicode，以及真实占用随机端口的启动失败测试 |
| docs/API_SPEC.md | 明确开发启动诊断的有限例外，HTTP 错误与生产日志规范保持原样 |
| docs/DECISIONS.md | ADR-026，记录诊断安全边界与不自动杀未知占用者的决策 |
| docs/API_STARTUP_REPORT.md | 本报告 |

只有 NODE_ENV=development 或未设置时，启动 catch 才输出异常 name/message/stack/code 和至多两层 cause。敏感环境值及 URL 编码值、连接 URL、Bearer/JWT、密码/Token/收件信息键值会遮蔽，文本有长度上限；不会序列化任意异常对象。production、test、非法 NODE_ENV 保持通用消息，不输出堆栈；配置错误保留安全字段名。没有向 HTTP 响应增加内部异常。

## 4. 实际运行与结果

| 命令或检查 | 结果 |
| --- | --- |
| Get-NetTCPConnection / Get-CimInstance | 实际确认 0.0.0.0:3000 由旧 API PID 52848 占用及其命令行/创建时间 |
| 原代码 `node apps/api/dist/main.js` | 退出 1，只显示通用错误，原问题成功复现 |
| 诊断代码 `pnpm --filter @caicang/api build` + 同一启动命令 | 构建成功；启动仍退出 1，实际记录 EADDRINUSE 及上述堆栈 |
| 停止旧实例 | 重新核实 PID 52848 身份与端口所有权后只停止该进程，未结束其他 Node 进程 |
| `pnpm --filter @caicang/api start` | 监听 0.0.0.0:3000，真实健康接口 HTTP 200，database=reachable |
| `pnpm dev:api` | 先停止本次正常模式验证实例，再启动开发模式；同一默认端口健康接口 HTTP 200，watch 模式运行正常 |
| `pnpm test:api` | 68 通过 / 0 失败 / 0 跳过；包含生成、共享包/API/fixture 构建和真实 HTTP 测试 |
| `pnpm --filter @caicang/api typecheck` | 退出 0 |
| `pnpm exec eslint apps/api/src scripts/api-foundation.test.mjs --max-warnings 0` | 退出 0，0 warning |
| `pnpm exec prettier --check apps/api/src/main.ts apps/api/src/common/logging.ts scripts/api-foundation.test.mjs` | 退出 0 |
| `git diff --check` | 通过；LF/CRLF 提示不是错误，未改 Git 全局设置 |
| 清理开发验证进程 | 仅终止本次创建的 watch-api PID 166724 及其编译/watch 子进程，防止残留 watcher 再抢端口 |
| 最后再执行正常 start | PID **161300**，创建于 19:50:27，实际监听 0.0.0.0:3000；19:51 复查健康接口 HTTP 200 |

最终健康结果：

```json
{"data":{"status":"ok","service":"caicang-api","database":"reachable","timestamp":"2026-10-23T11:51:07.291Z"},"requestId":"0ceb3afd-75db-489c-81b0-36819d4a7c3f"}
```

日志位于 Git 忽略的 test-results：

- api-startup-before.log：原始复现，仅通用消息。
- api-startup-diagnosed.log：修复后复现的真实 EADDRINUSE 堆栈。
- api-startup-build.log / api-startup-build-final.log / api-startup-build-test.log：实际构建。
- api-startup-foundation.log / api-startup-final-tests.log：两次相关测试，均 68 通过。
- api-startup-typecheck-final.log / api-startup-lint-final.log / api-startup-format-check.log：最终规范检查。
- api-startup-start.log / api-startup-dev.log / api-startup-final-server.log：正常、开发、最终保留实例的运行日志。

根 .env 与 .env.auth.local 的 SHA256 和排查前一致；未覆盖配置、重置数据库、删除卷或执行 schema.sql。没有编辑工作区已有及同期出现的手机端任务文件/README/CHANGELOG/package.json 等改动，也没有将其回退或纳入本次交付。只检查 API 相关构建和测试，没有声称本轮重新运行全仓测试或 Android 验收。

## 5. 现在如何运行与重启

**结束排查时已保留一个正常 API 实例（PID 161300）**，可直接访问：

- http://localhost:3000/api/v1/health
- http://localhost:3000/api/docs

不要再同时启动第二个 start/dev 实例。下面两种启动方式任选一种：

```powershell
cd D:\Dev\caicang-manager
pnpm --filter @caicang/api start   # 使用已构建代码
# 或在需要源码监听时使用：
pnpm dev:api
```

如需改为自己终端管理，先检查当前端口归属和命令行；PID 可能随重启变化，不能盲目复用上面的数值，更不能批量 taskkill 所有 Node。确认仍是本报告留下的正常 API 后，停止该进程再选一个启动命令。watch 模式应在其启动终端 Ctrl+C 整体停止，不能只结束内部 API 子进程后留下 watcher。

本次已确认并修复的问题没有遗留启动阻塞。若后续又失败，开发日志现在会给出脱敏异常；根据新的 code/message/stack 继续检查，不应把所有失败都归因于端口。
