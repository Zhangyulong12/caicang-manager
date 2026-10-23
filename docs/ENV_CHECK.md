# Windows 开发环境检查

## 最新阶段复核：2026-10-23

本节取代下面历史检查中的当前环境结论，完整过程见 [阶段复核](STAGE_REVIEW_00_20.md)。

| 检查项 | 本轮真实结果 |
| --- | --- |
| Windows | Windows 11 家庭版 25H2，26200.9711；按 [Microsoft 生命周期](https://learn.microsoft.com/en-us/lifecycle/products/windows-11-home-and-pro)仍受支持 |
| Git / Node / pnpm | 2.56.0.windows.2 / v22.22.2 / 11.25.0；实际命令成功，没有重装 |
| WSL2 | WSL 3.0.3.0；`wsl --system --exec uname -r` 实际返回 `6.18.54.1-microsoft-standard-WSL2` |
| Docker | Desktop 4.95.0，Server 29.8.2，Compose v5.6.0；实际 `docker run --rm hello-world` 成功 |
| PostgreSQL | 原 `caicang-postgres` 容器 healthy，16.15-alpine，127.0.0.1:5432；原卷 `caicang-manager-dev_caicang_pgdata` 保留 |
| 持久化盘符 | `D:\docker\DockerDesktopWSL\disk\docker_data.vhdx`，约 3.09 GiB；另有 D 盘 main/ext4.vhdx |
| 可用空间 | 检查时 C 约 52.20 GiB、D 约 356.00 GiB，足够本阶段开发 |
| 数据库迁移 | `prisma:migrate:status` / `prisma:migrate:deploy` 成功；6 个迁移已应用，无待执行迁移；未重放 schema.sql |
| API | 已实际启动，电脑访问 `http://192.168.243.90:3000/api/v1/health` 返回 200、database=reachable；这不等于手机网络已验证 |
| 手机构建配置 | 已有 .env.development 仍为 localhost，.env.production 仍为示例域名；均未覆盖。新增 `pnpm build:mobile:lan -ApiBaseUrl 'http://192.168.243.90:3000/api/v1'`，进程级覆盖后实际验证 App 资源中的地址 |
| HBuilderX / Android | 未在 PATH、卸载注册信息中发现 HBuilderX，未检测到已连接 Android 设备；导入、基座运行、相机和签名 APK 验收未执行 |

### 本轮环境恢复经过与剩余阻塞

只读检查时 Docker 未运行，5432/3000/5173 均无监听。此前 Docker 日志记录调用 `wsl.exe` 时 `Access is denied`（05:31/05:35 UTC），但当前终端 WSL 命令可执行；未取得足以确认具体安全软件或策略来源的证据。正常启动现有 Docker Desktop 后 Server 与原数据库自动恢复，未出现需要更改策略的阻塞。没有关闭安全软件、修改执行策略、防火墙或黑名单，没有重装软件、移动 C 盘用户数据或删除数据库卷。

当前数据库、后端集成测试的环境阻塞已解除。Android 真机验收仍需 HBuilderX、DCloud AppID、连接的 Android 手机，以及手机实际访问电脑 LAN 地址成功。若连接被防火墙或安全策略拦截，应先取得用户确认再调整，不能自行放行。

本轮两次 `pnpm test` 均为 528 通过/0 失败/0 跳过；任务 17/18 专项为 22/15 通过，模型 65、手机测试 15（含 11 个真实 API 子测试）、扫码 10 均通过。typecheck/lint/format/format:check 退出码均为 0。原卷、cluster 标识及已记录的开发库计数基线不变，三个既有 .env 文件 SHA256 不变，临时测试库无残留。首次手机夹具失败和修复后的真实日志见阶段报告，未修改业务断言来掩盖失败。

WSL 仍提示 localhost 代理未镜像至 NAT；本轮内核命令、Docker 和已有镜像容器成功，未据此修改代理或 WSL 网络配置。

## 最新复查：2026-10-14（用户完成环境准备后）

以下结果取代本文后面的首次任务 00 检查结论。此次没有重装 Git、Node.js、pnpm、VS Code；没有安装 Ubuntu、HBuilderX 或 PowerShell 7。

| 检查项 | 本次实际结果 | 是否阻塞任务 01 |
| --- | --- | --- |
| Windows | Windows 11 家庭版 25H2，Build 26200.9457；仍处于官方支持期 | 否 |
| WSL2 | WSL 3.0.3.0，内核 6.18.54.1-1；docker-desktop 分发运行于 VERSION 2 | 否 |
| Linux 命令 | `wsl --system --exec uname -r` 输出 `6.18.54.1-microsoft-standard-WSL2`，退出码 0 | 否 |
| Docker Desktop | 4.95.0 (242831)，已安装且运行 | 否 |
| Docker Engine | Client 和 Server 均为 29.8.2，Linux x86_64；`docker info` 正常 | 否 |
| Docker Compose | v5.6.0 | 否 |
| 测试容器 | `docker run --rm hello-world` 实际输出 `Hello from Docker!`，退出码 0 | 否 |
| Docker 数据 | `D:\docker\DockerDesktopWSL\disk\docker_data.vhdx` 已存在，另有 `main\ext4.vhdx` | 否 |
| Node / pnpm | 22.22.2 LTS / 11.25.0，沿用已有安装 | 否 |
| 空闲空间（启动前） | C 盘约 52.24 GiB，D 盘约 361.18 GiB | 否 |
| HBuilderX / Ubuntu / PowerShell 7 | 按用户指令暂不处理 | 否；Android 真机与 APK 验证仍待后续阶段 |

Windows 支持情况依据：[Microsoft 生命周期](https://learn.microsoft.com/en-us/lifecycle/products/windows-11-home-and-pro)。Docker 前置条件依据：[Docker 官方文档](https://docs.docker.com/desktop/setup/install/windows-install/)。

### D 盘数据位置的证据

- Docker `settings-store.json` 中 `CustomWslDistroDir=D:\docker\DockerDesktopWSL`。
- WSL 注册信息：`docker-desktop` 的 BasePath 为 `\\?\D:\docker\DockerDesktopWSL\main`，Version=2。
- 实际文件：`disk\docker_data.vhdx` 和 `main\ext4.vhdx` 均在上述 D 盘目录。C 盘默认 Docker WSL 目录未发现 VHDX。
- Docker 的 `/var/lib/docker` 是 Linux 内部目录，不能单凭该字符串判断 Windows 宿主盘符；上述设置、注册信息和实际 VHDX 共同确认数据位置。
- Docker 程序本体和少量用户配置仍在 C 盘，镜像、容器和本项目 PostgreSQL 命名卷使用 D 盘虚拟磁盘。无需剪切 AppData，也没有迁移或删除 C 盘用户文件。
- pnpm 内容仓已确认在 `D:\.pnpm-store\v11`，项目下载缓存配置在 `D:\Dev\caicang-manager\.cache\pnpm`；源码与 node_modules 位于 D 盘。

### 已修复的问题与当前阻塞

当前 Codex 进程继承了安装 Docker 前的 PATH，首次 hello-world 失败于找不到 `docker-credential-desktop`，退出码 127。仅给当前进程补入 Docker CLI 目录后重试成功；用 Machine/User PATH 新开普通 PowerShell，Docker 版本和 Server 查询也成功。开发脚本增加目录探测，无需重装 Docker 或修改系统 PATH。

WSL 命令仍提示 localhost 代理未镜像到 NAT 网络，但 Linux 命令及 Docker 拉取/运行已通过，因此目前不是任务 01 阻塞。若后续在 Linux 内部访问网络失败，再针对具体失败处理。

本次启动的 PostgreSQL 16.15 容器 `caicang-postgres` 已 Healthy，`pg_isready` 与真实 SQL 查询成功。任务 01 的依赖安装、类型检查、构建和接口测试结果另见 `TASK_01_REPORT.md`。目前没有环境阻塞项；Android 工具和签名/真机验收属于后续阶段，不计作本次未完成环境。

## 首次任务 00 的历史记录（已被以上复查结果取代）

检查日期：2026-10-14（Asia/Shanghai）。项目目录：`D:\Dev\caicang-manager`。

结论：Git、Node.js、pnpm、Corepack、VS Code、PowerShell 可执行，D 盘空间充足；尚不能完成 PostgreSQL 容器开发或 Android 打包。Windows 版本需要更新，WSL2 缺少内核，未发现 Docker Desktop 和 HBuilderX。没有运行业务测试、数据库迁移或 APK 验收。

## 1. 主机与空间实测

| 项目 | 实测结果 |
| --- | --- |
| 操作系统 | Windows 11 家庭中文版，22H2，x64，Build 22621.2428 |
| CPU | AMD Ryzen 7 7840H |
| 内存 | 15.19 GiB（约 16 GB） |
| C 盘剩余 | 42.18 GiB |
| D 盘剩余 | 352.27 GiB |
| 固件虚拟化 | `VirtualizationFirmwareEnabled=True` |
| Hypervisor | `HypervisorPresent=True` |
| 当前权限 | 普通用户，非管理员 |

D 盘足够放置源码、依赖、容器镜像和 Android 工具；建议后续持续保留至少 50 GiB 空闲，这是项目预留建议，并非实测软件最低要求。C 盘用户文件未删除、迁移或清理。WMI 的 SLAT 字段返回 False，但同时检测到已运行的 Hypervisor，不能据此断言 CPU 不支持虚拟化；是否可用仍需以修复后的 WSL2 和 Docker 引擎启动结果为准。

Windows 11 家庭版 22H2 已于 2024-10-08 结束支持；Docker 官方要求使用仍在 Microsoft 支持期内的 Windows，页面列出的 Windows 11 基线为 Build 22631 或更高。请通过 Windows Update 升级至当前仍受支持的版本，不以安装旧 Docker 绕过系统条件。家庭版可运行本项目需要的 Linux 容器，无需为此更换 Windows 专业版。

来源：[Microsoft 22H2 生命周期](https://learn.microsoft.com/en-us/lifecycle/announcements/windows-11-22h2-end-of-updates-home-pro)、[Docker Windows 条件](https://docs.docker.com/desktop/setup/install/windows-install/)。

## 2. 八项工具实测

| 工具 | 实际版本／安装位置 | 是否可执行与限制 |
| --- | --- | --- |
| Git | `2.56.0.windows.2`；`D:\Git\cmd\git.exe` | `git --version` 成功；已初始化 main 分支 |
| Node.js | `v22.22.2`；`D:\nodejs\node.exe` | 成功执行，`process.release.lts=Jod`，x64；属于受支持的 22.x LTS 分支 |
| pnpm | `11.25.0`；`D:\nodejs\pnpm.cmd` / `pnpm.ps1` | 普通 Windows PowerShell 和 Codex 均已实测成功 |
| Corepack | `0.34.6`；`D:\nodejs\corepack.cmd` | 成功；已启用 pnpm shim 并准备精确版本 |
| Docker Desktop | 未发现安装；版本无法输出 | CLI、常见安装路径、卸载记录、Docker 进程和服务均未发现；引擎未启动 |
| WSL2 | 系统自带 `wsl.exe` 文件版本 `10.0.22621.4745`；不是现代 WSL 包版本 | 系统组件已启用，但缺少 WSL2 内核，没有发行版；不可用 |
| VS Code | CLI 与程序文件均为 `1.141.0`，x64；`D:\HarmonyOS\新建文件夹\Microsoft VS Code` | `code --version` 成功，已存在运行进程；卸载注册记录为 1.141.1，与实际文件有差异，以实际输出为准 |
| HBuilderX | 未发现安装，版本无法输出 | 未找到可执行文件或运行进程，尚未验证启动 |
| PowerShell | Windows PowerShell `5.1.22621.2428`；Codex 内置 PowerShell `7.6.5` | 两者可执行；普通系统 PATH 未提供 `pwsh`，本阶段可使用系统 PowerShell 5.1 |

HBuilderX 单独说明：未发现安装，版本无法输出，未验证能启动。检查了 PATH、卸载记录、进程、C 盘常见安装目录和 D 盘可访问目录中的 `HBuilderX.exe`。便携软件若位于其它位置，需提供其实际路径再核验，不能仅凭 PATH 没有命令判断。

Node 兼容依据：[Node 官方发布表](https://nodejs.org/en/about/previous-releases)显示 22.x 为 LTS；[Prisma 7 升级指南](https://www.prisma.io/docs/guides/upgrade-prisma-orm/v7)推荐 Node 22.x；[NestJS 入门](https://docs.nestjs.com/first-steps)列明 Node 前置要求。pnpm 11.25.0 的官方 registry 元数据要求 Node `>=22.13`，本机满足。此处仅验证环境兼容，API 实际安装、ESM 配置和构建留待阶段 01。

## 3. 实际命令与输出

以下输出均来自本次执行；不存在的工具没有标记为通过。

```text
git --version                    -> git version 2.56.0.windows.2
node --version                   -> v22.22.2
node process.release.lts         -> Jod
pnpm --version                   -> 11.25.0
corepack --version               -> 0.34.6
code --version                   -> 1.141.0 / 2a59476c9bfcb90b3ddc372c36762471b7dfad1c / x64
Windows PowerShell PSVersion     -> 5.1.22621.2428
Codex PowerShell PSVersion       -> 7.6.5
docker --version                 -> 命令不存在
docker version                   -> 命令不存在，无法查询 Client/Server
docker compose version           -> 命令不存在
docker info                      -> 命令不存在，未验证引擎健康
wsl --version                    -> 命令行选项无效: --version；退出码 4294967295
wsl --status                     -> 默认版本 2；未找到 WSL 2 内核文件；Windows 更新已暂停
wsl --list --verbose             -> 没有已安装的分发版；退出码 4294967295
```

注意：`wsl --status` 退出码为 0，但文字明确提示内核缺失，因此不能判为 WSL2 正常。首次 WSL 输出存在 UTF-16 编码乱码；用 Node 子进程按 UTF-16LE 重新读取后获得上述结果，没有忽略失败。

## 4. 已完成的环境准备

1. 创建原本不存在的 `D:\Dev\caicang-manager`。
2. 从 `D:\import and export\introduce\caicang-manager` 复制 16 个设计资料文件，逐文件 SHA-256 校验一致，原目录完整保留；未覆盖已有目标文件。
3. `git init -b main` 成功；沿用已有 Git 身份配置，没有修改全局身份或创建远程仓库。
4. 创建 `.gitignore`，忽略依赖、环境私密配置、构建缓存、APK/AAB、签名文件和本地数据库数据；保留 `.env.example`、数据库参考 SQL 和后续迁移。
5. 原来 pnpm 11.25.0 仅由 Codex 的 fallback 提供，普通系统 PATH 中没有 pnpm。执行 `corepack enable pnpm` 和 `corepack install --global pnpm@11.25.0`，使已有 Node 安装目录提供 pnpm 命令；没有重装 Node 或 Corepack。Corepack 下载的是包管理器，并未安装业务依赖。来源：[Corepack 官方说明](https://github.com/nodejs/corepack)。
6. 用新的 `powershell.exe -NoProfile` 子进程，仅保留 Machine/User PATH，实测 Git、Node、Corepack、pnpm、VS Code 的版本全部成功；pnpm 不再依赖 Codex 注入的 PATH。
7. 更新 README、环境报告和决策记录；业务代码未创建。

## 5. 缺少工具的官方下载与步骤

### Windows / WSL2：先更新系统，再修复内核

1. 打开“设置 → Windows 更新”，恢复更新并检查更新，按提示升级到仍受支持的 Windows 11 版本并重启。该操作需要用户在系统界面完成，本次未更改系统更新设置。
2. 在管理员 PowerShell 执行：

```powershell
wsl --update
wsl --version
wsl --status
```

3. 若更新后仍不支持 `--version`，按 [Docker 的 WSL 更新指引](https://docs.docker.com/desktop/setup/install/windows-install/#wsl-verification-and-setup)从 [Microsoft WSL 官方 Releases](https://github.com/microsoft/WSL/releases)下载稳定版 x64 MSI，安装后重启并复查。现代 WSL 包需达到 Docker 文档要求的 2.1.5 或更高。
4. 若需要 Ubuntu 作为开发终端，可执行 `wsl --install -d Ubuntu`，首次启动设置 Linux 用户，然后用 `wsl --list --verbose` 确认 VERSION=2。安装 Ubuntu 对 Windows 原生 Node 开发不是硬性要求，Docker 使用其自身的 WSL 环境；不要把“无 Ubuntu”作为唯一失败依据。

官方步骤：[Microsoft WSL 安装](https://learn.microsoft.com/en-us/windows/wsl/install)。不要执行注销发行版、删除虚拟磁盘或迁移用户目录。

### Docker Desktop：安装并验证 Server

官方下载：[Docker Desktop Windows 安装页](https://docs.docker.com/desktop/setup/install/windows-install/)。

1. 系统更新和 WSL2 修复后，下载 Windows x86_64 安装程序，选择 WSL2 backend / Linux containers，按向导安装。
2. 启动 Docker Desktop，完成首次界面提示，等待引擎 Ready。安装程序结束不等于引擎已启动。
3. 如希望新建容器磁盘使用 D 盘，安装时使用官方提供的数据目录选项或应用设置；不要自行剪切 C 盘 AppData 或已有虚拟磁盘。
4. 新开 PowerShell 执行：

```powershell
docker --version
docker compose version
docker version
docker info
docker run --rm hello-world
```

验收必须看到 `docker version` 的 Client **和 Server**，`docker info` 能连接引擎，测试容器实际运行成功。以上安装后命令为待执行步骤，当前没有成功结果。本阶段不启动项目 PostgreSQL、不执行建表 SQL。

### HBuilderX：安装 Android 开发工具

官方下载：[DCloud HBuilderX](https://dcloud.net.cn/hbuilderx.html)；官方 Windows 说明：[安装指引](https://hx.dcloud.net.cn/Tutorial/install/windows)。

1. 下载 Windows x64 稳定版（按当前官网提供的安装包选择，补齐 App 开发插件）。
2. 若为 ZIP，完整解压到新目录，例如 `D:\Tools\HBuilderX`，再启动 `HBuilderX.exe`；不要直接在压缩包内运行。
3. 按向导安装 uni-app / App 开发所需插件，在“帮助 → 关于”记录实际版本。
4. 手机 USB 驱动、真机连接、相机与扫码、签名 APK 在后续 Android 阶段验证。本阶段没有 APK，不声明打包成功。

Git、Node、VS Code、系统 PowerShell 已可用，无需重装。若将来需要在普通终端使用 PowerShell 7，可选安装 [Microsoft PowerShell](https://learn.microsoft.com/en-us/powershell/scripting/install/installing-powershell-on-windows)，不是当前任务阻塞。

## 6. 检查与未解决事项

- Git 初始化、普通终端版本命令、复制哈希：已实测。
- `.gitignore`：使用 `git check-ignore --no-index --quiet` 验证 27 条应忽略路径、8 条应保留路径，全部符合预期；无需创建真实密钥或临时数据库文件。
- 资料保护：复制时 16 个文件哈希一致；更新 README 和 DECISIONS 后，其余 14 个资料文件再次校验 SHA-256 一致。
- Git 快照：提交说明为 `chore: prepare Windows environment and import project specifications`，实际提交与工作区状态可通过 `git log -1 --oneline` 和 `git status --short --branch` 核查。
- `git diff --cached --check`：已运行，通过。Git 提示现有 autocrlf 将在之后的检出时转换换行，这不是检查失败；未更改用户的全局 Git 配置。
- Docker 版本与引擎验收：未通过，未发现安装，需要安装后复查。
- WSL2：未通过，内核缺失，需要更新后复查。
- HBuilderX：未验证，需要安装或提供实际路径。
- Windows 22H2：不满足当前受支持环境条件，需要系统更新。
- lint / typecheck / build / 单元测试 / DB / APK：未运行，当前只有设计资料，没有相关应用脚本。

下一步：依次完成 Windows 更新、WSL2、Docker、HBuilderX，然后复查本报告中的失败项。环境复查后，由用户明确发出阶段 01 指令，再建立 Monorepo、数据库容器和 API 骨架。
