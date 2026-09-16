<div align="center">

<img src="./public/logo.svg" alt="Technitium DNS Console" width="96" height="96" />

# Technitium DNS Console

**面向 Technitium DNS Server 的现代化双语（中 / 英）Web 管理控制台**

[中文](./README.md) | [English](./README.en.md)

</div>

---

## 项目简介

本项目是一个独立开发的 **Web 控制台**，用于管理 [Technitium DNS Server](https://technitium.com/dns/)。它不是 DNS 服务器本身，而是一层运行在 Next.js 之上的图形化管理界面，通过内置代理对接 Technitium 的 HTTP API（当前对齐 **v15.4**，共 **129 个端点**）。

相较于官方自带的 Web 界面，本控制台专注于：

- **中英双语**：所有界面文案通过 `next-intl` 管理，中 / 英键树完全对齐，可运行时切换。
- **现代化的操作体验**：基于 Radix UI + Tailwind CSS v4 构建的高密度运维界面，支持浅色 / 深色主题。
- **纵深防御的代理层**：所有请求经由一个 catch-all 代理转发，内置 SSRF 防护、IP 固定（防 DNS 重绑定）、httpOnly 令牌 Cookie、端点白名单与审计日志。
- **多服务器管理**：可在浏览器端保存多个 Technitium 服务器配置并随时切换，令牌按来源隔离存储。

> 本项目与 Technitium 官方无隶属关系，属于社区独立实现。

## 功能特性

覆盖 Technitium DNS Server 的主要管理场景：

| 模块                          | 能力                                                                                                  |
| ----------------------------- | ----------------------------------------------------------------------------------------------------- |
| **仪表盘**                    | 查询统计、Top 域名 / 客户端、图表可视化                                                               |
| **区域（Zones）**             | 区域增删改查、导入 / 导出 / 克隆 / 转换、记录管理、区域选项、区域 ACL 权限、**DNSSEC** 签名与密钥管理 |
| **DNS 客户端**                | 从指定服务器发起解析测试（支持 DNSSEC、EDNS Client Subnet）                                           |
| **缓存**                      | 查看 / 删除 / 清空缓存记录                                                                            |
| **过滤（Allowed / Blocked）** | 允许 / 阻止域名列表管理、导入 / 导出、临时禁用拦截                                                    |
| **日志**                      | DNS 查询日志与系统日志的分页查询、下载、导出                                                          |
| **DHCP**                      | 作用域与租约管理                                                                                      |
| **应用（Apps）**              | 已安装应用管理、从应用商店安装 / 更新                                                                 |
| **设置**                      | DNS / 日志 / Web 服务 / 拦截列表等全局配置、备份与恢复                                                |
| **管理（Admin）**             | 用户、用户组、权限、会话、集群（Cluster）、SSO 配置                                                   |
| **账户**                      | 个人资料、修改密码、两步验证（2FA / TOTP）、API 令牌、我的会话                                        |

导航按 **权限分区（Permission Section）** 门控：菜单可见性与路由守卫共用同一份声明式配置（见 [`lib/nav.ts`](./lib/nav.ts)），登录后自动落到当前用户有权访问的第一个页面。

## 技术栈

| 分类               | 选型                                                                                  |
| ------------------ | ------------------------------------------------------------------------------------- |
| 框架               | Next.js 16（App Router）、React 19、TypeScript 5.9（`strict`）                        |
| 样式               | Tailwind CSS v4（CSS-first，**无 `tailwind.config.ts`**，令牌位于 `app/globals.css`） |
| 组件               | Radix UI Primitives + `class-variance-authority` + `cn`                               |
| 数据               | TanStack Query v5（服务端状态）、TanStack Table v8（表格）                            |
| 表单               | react-hook-form + zod                                                                 |
| 国际化 / 主题      | next-intl、next-themes                                                                |
| 图标 / 图表 / 提示 | lucide-react v1.45、recharts、sonner                                                  |
| 代理传输           | undici（自定义 Dispatcher，实现 IP 固定）                                             |
| 测试               | Vitest（单元 / 组件，jsdom）、Playwright（E2E）、Testing Library                      |
| 包管理             | pnpm 11（Node >= 20.9.0）                                                             |

## 架构设计

### 请求代理

浏览器从不直接访问 Technitium 服务器。所有上游调用都经过单一 catch-all 路由 [`app/api/dns/[...path]/route.ts`](./app/api/dns/[...path]/route.ts)，其本身只是薄壳，真正的逻辑集中在可独立单测的 [`lib/proxy/kernel.ts`](./lib/proxy/kernel.ts)：

```
GET|POST /api/dns/<endpoint>?<params>  →  <target>/api/<endpoint>?<params>
```

代理管线（10 步）：

1. 从 `X-Dns-Target` 请求头解析目标，否则回退到 `TECHNITIUM_API_URL`；
2. **SSRF 校验** + DNS 解析；
3. 将校验通过的 IP **固定**进 Dispatcher（防 DNS 重绑定）；
4. 读取该服务器对应的 httpOnly 令牌 Cookie；
5. **端点白名单** + **HTTP 方法白名单**（由注册表驱动）；
6. 原样转发查询串与请求体，注入 `Authorization: Bearer`；
7. 按响应类型施加超时（JSON 30s / 文件 120s）；
8. 将 Technitium 的四种 `status` 语义翻译为标准 HTTP 状态；
9. 拆封响应信封（或流式透传文件下载）；
10. 写入一行审计日志。

### 安全模型

- **令牌不可被脚本读取**：登录成功后，会话令牌写入按来源隔离的 httpOnly Cookie，且登录 / 会话响应中的 `token` 字段会被剥离，绝不返回给前端 JS。
- **SSRF 防护**（[`lib/proxy/target.ts`](./lib/proxy/target.ts)）：始终阻断云元数据地址（`169.254.169.254`、`fd00:ec2::254`）、组播 / 保留 / 未指定地址；对不受信的请求来源额外阻断回环与链路本地地址；对 IPv4-mapped / NAT64 地址先解包再校验；主机名的**所有**解析结果都需通过校验，并固定最终 IP，防止二次解析投毒。
- **注册表驱动的白名单**：允许的端点、方法、鉴权要求、信封形状集中定义于 [`lib/api/registry.ts`](./lib/api/registry.ts)，令 SDK 类型与代理白名单始终一致。
- **安全响应头**：全局注入 `X-Content-Type-Options: nosniff`、`X-Frame-Options: DENY`、`Referrer-Policy`（见 [`next.config.ts`](./next.config.ts)）。
- **破坏性操作二次确认**：删除、清空、卸载、吊销、恢复等操作一律经由确认对话框。

### 目录结构

```
app/
  (auth)/login/            未登录页面
  (console)/…              鉴权后的控制台页面（每个路由为 Server Component 薄壳）
  api/dns/[...path]/       唯一的 catch-all 代理路由
  api/auth/token/          认证相关路由
components/
  ui/                      shadcn 风格基础组件（每文件一个组件）
  app/                     跨页面构件（数据表格、页面骨架等）
  layout/                  侧边栏、顶栏、切换器（仅界面外壳）
  charts/                  recharts 封装
  <module>/                各业务模块的客户端视图与对话框
lib/
  api/                     代理客户端 + 类型化 SDK（domains/ 按域拆分，types/ 类型，registry 白名单）
  proxy/                   代理内核（kernel / target / forward / envelope / cookies / audit / errors）
  auth/                    会话上下文
  servers/                 多服务器配置存储与 Provider
  format/                  纯展示格式化函数（locale 显式传入）
  hooks/                   客户端 Hooks
  i18n/                    next-intl 配置
messages/{zh,en}/          16 个命名空间的文案（中英键树对齐）
scripts/                   i18n 校验、图标校验、API 探测 / 生成、截图等
tests/                     Vitest 单元 / 组件测试；E2E 位于 Playwright 约定目录
docs/                      API 端点、页面实现范式、UI 约定
```

## 快速开始

### 前置条件

- **Node.js >= 20.9.0**、**pnpm 11**（`corepack enable` 即可启用）。
- 一个**可访问的 Technitium DNS Server 实例**（默认 `http://127.0.0.1:5380`），以及其管理员账号。

### 安装与运行

```bash
# 1. 安装依赖
pnpm install

# 2. 配置环境变量（按需修改上游地址等）
cp .env.example .env.local

# 3. 启动开发服务器（默认端口 5390）
pnpm dev
```

打开浏览器访问 <http://localhost:5390>，使用 Technitium 的账号登录即可。

> 未选择服务器时，代理回退到 `TECHNITIUM_API_URL`；你也可以在界面右上角的服务器切换器中添加 / 切换多个服务器配置（保存在浏览器端）。

### 生产构建

```bash
pnpm build
pnpm start        # 同样监听 5390 端口
```

## 环境变量

复制 [`.env.example`](./.env.example) 为 `.env.local` 并按需调整：

| 变量                                                             | 说明                                                                                                                             | 默认值                  |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| `TECHNITIUM_API_URL`                                             | 未选择服务器配置时使用的上游 DNS 服务器地址                                                                                      | `http://127.0.0.1:5380` |
| `TECHNITIUM_ALLOWED_TARGETS`                                     | 逗号分隔的目标白名单；**设置后仅允许这些 `host:port`**，宽松守卫失效。留空为宽松模式（回环 / 链路本地 / 云元数据地址始终被阻断） | 空                      |
| `SESSION_COOKIE_PREFIX`                                          | Cookie 名称前缀，生产环境请配合随机值加固                                                                                        | `tdns`                  |
| `PROXY_TIMEOUT_JSON_MS`                                          | JSON 请求超时（毫秒）                                                                                                            | `30000`                 |
| `PROXY_TIMEOUT_FILE_MS`                                          | 文件下载超时（毫秒）                                                                                                             | `120000`                |
| `PROXY_AUDIT_LOG`                                                | 设为 `true` 时，为每次代理调用记录一行审计日志                                                                                   | `true`                  |
| `E2E_BASE_URL` / `E2E_DNS_URL` / `E2E_DNS_USER` / `E2E_DNS_PASS` | **仅** Playwright E2E 使用，应用运行时不会读取；环境变量覆盖，内置默认见 `tests/e2e/env.ts`                                      | 内置默认                |

## 常用脚本

| 命令                                                   | 作用                                    |
| ------------------------------------------------------ | --------------------------------------- |
| `pnpm dev`                                             | 启动开发服务器（端口 5390）             |
| `pnpm build` / `pnpm start`                            | 生产构建 / 启动                         |
| `pnpm lint` / `pnpm lint:fix`                          | ESLint 检查 / 自动修复                  |
| `pnpm format`                                          | Prettier 格式化                         |
| `pnpm typecheck`                                       | TypeScript 类型检查（`tsc --noEmit`）   |
| `pnpm test` / `pnpm test:watch` / `pnpm test:coverage` | 运行 Vitest / 监听模式 / 覆盖率         |
| `pnpm e2e` / `pnpm e2e:ui`                             | 运行 Playwright E2E / UI 模式           |
| `pnpm i18n:check`                                      | 校验中 / 英键树对齐                     |
| `pnpm i18n:usage`                                      | 校验「代码使用了但文案缺失」的键        |
| `pnpm icons:check`                                     | 校验 lucide v1.45 图标名                |
| `pnpm audit:coverage` / `pnpm audit:params`            | API 覆盖率 / 参数审计                   |
| `pnpm verify`                                          | **完整质量门禁**（见下）                |
| `pnpm probe` / `pnpm probe:types`                      | 从运行中的服务器探测 API / 生成类型草稿 |

## 测试与质量门禁

改动被视为完成前，需通过 `pnpm verify`，它按序执行：

```
i18n:check → i18n:usage → audit:coverage → audit:params → typecheck → lint → test → build
```

- **单元 / 组件测试**：Vitest + Testing Library，覆盖组件、格式化、代理内核与 API 域函数。
- **端到端测试**：Playwright，通过 `E2E_*` 环境变量指向真实服务器（内置默认见 `tests/e2e/env.ts`）。
- 详细约定见 [`docs/ui-conventions.md`](./docs/ui-conventions.md) 与 [`docs/page-patterns.md`](./docs/page-patterns.md)。

## 国际化

- 文案位于 `messages/<locale>/<namespace>.json`，共 **16 个命名空间**：`common`、`nav`、`auth`、`errors`、`dashboard`、`zones`、`records`、`dnssec`、`filtering`、`logs`、`dhcp`、`apps`、`dnsClient`、`settings`、`admin`、`account`。
- `zh` 与 `en` 的键树必须完全一致，由 `pnpm i18n:check` 强制校验。
- **禁止硬编码任何面向用户的字符串**：客户端用 `useTranslations('<namespace>')`，服务端用 `getTranslations`。新增键须在同一改动中补齐两种语言。

## API 端点注册表

Technitium 的 API 面（端点、方法、鉴权、信封形状、参数）记录于 [`docs/api-endpoints.md`](./docs/api-endpoints.md)，由 `scripts/probe/` 从运行中的服务器控制台产物自动生成。新增或变更端点时，可通过 `pnpm probe` 重新探测。

## 声明

本项目为社区独立实现，**未隶属于 Technitium Software，也未获其背书**。Technitium DNS Server 及其商标归 Technitium Software 所有。使用本项目前请自行评估安全性与合规性。本项目以 [MIT 许可证](./LICENSE) 发布；