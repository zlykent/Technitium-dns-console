# 架构证据索引 — Technitium DNS Console

配套文件：`system-model.structurizr.dsl`（C4 模型源，真相源）、`module-map.dot`（模块依赖图源）、`system-model.summary.md`（阅读说明）。

- **视图状态**：全部为 `current`（当前态）。本模型不含目标态、提案态或运行时观测态。
- **生成时间**：2026-09-14
- **证据采集方式**：逐文件读取源码 + 全仓 grep 验证边界 + 实际运行 `scripts/audit-coverage.mjs` 取得硬指标。
- **置信度约定**：`high` = 有直接代码/配置/命令输出证据；`medium` = 多个间接信号一致但无单一直接来源；`low` = 由命名或目录结构推断；`unknown` = 明确留白待验证。

---

## 1. 规模与形状（实测）

| 指标 | 值 | 证据类型 | 来源 | 置信度 |
| --- | --- | --- | --- | --- |
| 上游端点数 | 129 | code（生成物） | `lib/api/registry.ts:9`、`:202`；`docs/api-endpoints.md:4` | high |
| 注册表实际键数 | 129 | runtime（命令输出） | `node scripts/audit-coverage.mjs` → `upstream 129 · registry 129 · called by the SDK 128` | high |
| SDK 实际调用的端点数 | 128 | runtime（命令输出） | 同上；唯一例外 `user/createSingleUseToken` 在 `scripts/audit-coverage.mjs:43-50` 的 `DELIBERATELY_UNUSED` 中有书面理由 | high |
| 注册表一致性断言 | 通过 | code（测试） | `tests/node/registry.test.ts:5-7` 断言 `Object.keys(ENDPOINTS).length === ENDPOINT_COUNT` | high |
| 源码规模 | 39 953 行 `.ts/.tsx`（`lib` + `app` + `components`） | runtime（行数统计） | `Get-ChildItem -Recurse -Include *.ts,*.tsx` | high |
| 测试规模 | 15 386 行；`tests/node` 24 个测试文件、`tests/dom` 17 个测试文件（+ `setup.ts` 与 `utils/`）、`tests/e2e` 13 个 spec | runtime（目录枚举） | `tests/**` | high |
| API 域数 | 15（`API_DOMAINS`） | code | `lib/api/registry.ts:11-27` | high |
| 域 SDK 模块数 | 13 | code | `lib/api/domains/*.ts`（13 个文件，均以 `import { apiRequest } from '../client'` 开头） | high |
| i18n 命名空间数 | 16 × 2 语言 = 32 个 JSON | code | `lib/i18n/messages.ts:15-47`、`:91` | high |
| 控制台路由数 | 17 个 `page.tsx`（12 个顶级页 + `/zones/[zone]` 自身 + 其 3 个子路由 options/permissions/dnssec） | code | `app/(console)/**/page.tsx` 枚举 | high |
| 组件文件数 | 32 个 `components/ui/*` 文件 + 12 个业务模块目录 | code | `components/**` 枚举 | high |
| 运行时依赖数 | 34 个 `dependencies` | config | `package.json:29-64` | high |

---

## 2. L1 系统上下文节点

| 节点 ID | 标签 | 类型 | 证据（sourceRefs） | 置信度 |
| --- | --- | --- | --- | --- |
| `operator` | DNS 运维管理员 | actor | `README.md:15-27`（定位为 Web 管理控制台）；`components/auth/login-form.tsx:36-184`（登录表单）；`lib/nav.ts:50-92`（按权限分区的运维菜单） | high |
| `console` | Technitium DNS Console | system | `package.json:2-5`；`README.md:17`；仓库根目录 | high |
| `technitium` | Technitium DNS Server | external-system | `lib/api/registry.ts:4`（"harvested from the Technitium DNS Server v15.4 web console"）；`lib/proxy/forward.ts:145`（`User-Agent: TechnitiumDnsWebConsole/1.0`）；`.env.example:6`（默认 `http://127.0.0.1:5380`） | high |

**边界断言**：浏览器与上游之间不存在直连路径。
证据：`lib/api/client.ts:8-12` 注释明确 "the browser never talks to the DNS server directly (it cannot — the upstream sends no CORS headers)"；全仓仅 `lib/proxy/forward.ts:154` 一处发起对上游的 `fetch`（`undiciFetch`）。置信度 high。

**本系统不持有 DNS 数据**：仓库内无数据库、无 ORM、无迁移目录、无 `.sql`。唯一的持久化是浏览器侧 `localStorage` 与 Cookie。证据：`package.json:29-64` 无任何 DB 驱动；`lib/servers/store.ts:12-13` 定义两个 storage key。置信度 high。

---

## 3. L2 容器节点

| 节点 ID | 标签 | 证据（sourceRefs） | 置信度 |
| --- | --- | --- | --- |
| `console.browserApp` | 浏览器端控制台 | `components/**` 中大量 `'use client'`（如 `components/app/console-shell.tsx:1`、`lib/auth/session.tsx:1`、`lib/servers/provider.tsx:1`）；`app/providers.tsx:26-43` Provider 栈 | high |
| `console.nextServer` | Next.js 服务端 | `app/api/dns/[...path]/route.ts:13-16`（`runtime='nodejs'`、`dynamic='force-dynamic'`、`maxDuration=300`）；`next.config.ts:11`（`serverExternalPackages: ['undici']`）；`app/layout.tsx:42-53`（async Server Component） | high |
| `console.sharedContract` | 共享 API 契约（同构） | `lib/api/registry.ts` 被服务端（`lib/proxy/kernel.ts:2`、`audit.ts:1`、`envelope.ts:1`、`forward.ts:3`）与浏览器端（`lib/api/client.ts:3`、`lib/api/query-keys.ts:1`）同时导入；两模块均无 `node:*` 或 BOM 依赖 | high |
| `console.cookieStore` | httpOnly 令牌 Cookie | `lib/proxy/cookies.ts:21`（前缀 `tdns_t_`）、`:26`（Max-Age 7 天）、`:33-36`（sha256 派生名）、`:80`（`HttpOnly`）；`lib/proxy/kernel.ts:200`（写入）、`:188`/`:213`（删除） | high |
| `console.localStore` | 服务器配置存储 | `lib/servers/store.ts:12`（`tdns.servers.v1`）、`:18-23`（`{id,name,url}`，无凭据字段）、`:125-133`（写入 + 配额失败降级） | high |

### 3.1 Provider 栈顺序（有约束的组装）

证据：`app/providers.tsx:10-43`。注释显式声明 "Order is load-bearing"：
`ThemeProvider → NextIntlClientProvider → QueryProvider → ServersProvider → SessionProvider → TooltipProvider`。
其中 `ServersProvider` 必须先于 `SessionProvider`，因为 `lib/auth/session.tsx:45-53` 用 `useServers().ready` 作为 `enabled` 门控。置信度 high。

---

## 4. L3 服务端组件（代理层）

| 节点 ID | 文件 | 关键证据行 | 置信度 |
| --- | --- | --- | --- |
| `proxyRoute` | `app/api/dns/[...path]/route.ts` | `:22-30` 仅解包 `params` 并调 `handleProxy` | high |
| `tokenRoute` | `app/api/auth/token/route.ts` | `:36-92` POST 验证优先；`:84` 剥除 token；`:95-105` DELETE 清 Cookie | high |
| `kernel` | `lib/proxy/kernel.ts` | `:19-29` 管线注释；`:59-230` 实现；`:303-326` 单一错误出口 | high |
| `targetGuard` | `lib/proxy/target.ts` | `:45-61` 绝对阻断表；`:64-73` 严格阻断表；`:82-105` IPv4-mapped/NAT64 解包；`:219-229` 全部解析结果校验 | high |
| `transport` | `lib/proxy/forward.ts` | `:52-68` `pinnedLookup`；`:70-96` dispatcher 缓存（上限 16）；`:113-115` 按 kind 超时；`:154-162` `redirect:'error'` | high |
| `statusTranslate` | `lib/proxy/errors.ts` | `:14-18` `STATUS_TO_CODE`；`:34-107` `translateUpstream` | high |
| `envelopeMod` | `lib/proxy/envelope.ts` | `:69-97` `unwrapEnvelope` + 自愈；`:29` `TRANSFORMS` 刻意为空 | high |
| `cookieMod` | `lib/proxy/cookies.ts` | `:33-36`、`:74-91`、`:97-120` | high |
| `auditMod` | `lib/proxy/audit.ts` | `:12-25` 窄记录字段；`:31-77` Sink 接口 + Console/Memory/Multi 三实现；`:89-97` `classifyOutcome` | high |
| `i18nRequest` | `lib/i18n/request.ts` | `:14-30` Cookie 优先 + `Accept-Language` 兜底 | high |
| `messagesBundle` | `lib/i18n/messages.ts` | `:15-47` 32 个静态 import；`:10-12` 注释说明为何不用动态 import | high |

### 4.1 10 步管线的逐步证据

| 步 | 行为 | 证据 |
| --- | --- | --- |
| 1 | 取目标：`X-Dns-Target` 头，否则 `TECHNITIUM_API_URL` | `kernel.ts:89`、`:94`；`target.ts:169-177`；头名常量 `kernel.ts:35` = `'x-dns-target'` |
| 2 | SSRF 校验 + DNS 解析 | `target.ts:196-235`（`isIP` 分支与 `lookup(all:true, verbatim:true)` 分支） |
| 3 | 固定已校验 IP | `target.ts:237` 返回 `pinnedAddress`；`forward.ts:76` 注入 `connect.lookup` |
| 4 | 取该 origin 的令牌 Cookie | `kernel.ts:100-103`；`cookies.ts:117-120` |
| 5 | 端点白名单 + 方法白名单 | `kernel.ts:67-87`（`isKnownEndpoint` → `def.methods.includes`） |
| 6 | 原样转发 + 注入 Bearer | `kernel.ts:105`（`buildUpstreamUrl` 复制查询串）、`:109-117`（body）、`forward.ts:149` |
| 7 | 按 kind 超时 | `forward.ts:29-30`、`:113-115`、`:159` |
| 8 | 翻译四种 status | `kernel.ts:182`；`errors.ts:34-107` |
| 9 | 拆信封或流式透传 | `kernel.ts:146-156`（file 直通）、`:193`（`unwrapEnvelope`） |
| 10 | 写一行审计 | `kernel.ts:147-154`、`:216-223`、`:311-319`（错误路径同样写） |

### 4.2 令牌不外泄的三重机制

1. `STRIPS_TOKEN = {user/login, user/session/get}` → 响应体中 `token` 字段被浅拷贝剥除（`kernel.ts:52`、`:194`、`:259-264`）。
2. 令牌只写入 `httpOnly` Cookie（`cookies.ts:80`），且 Cookie 名按 origin 派生，因此多服务器不互相覆盖（`cookies.ts:5-13` 注释）。
3. 下载不走官方控制台的 `?token=` 单次令牌 URL，而是由代理流式透传（`client.ts:131-137` 注释 + `kernel.ts:270-284` `streamFile`）。
   注意 `kernel.ts:44-51` 明确把 `user/createToken` 与 `admin/sessions/createToken` 排除在剥离之外——这两个端点铸造的是运维需要抄下来的新长效令牌。
   置信度 high。

### 4.3 SSRF 守卫的分层策略

| 层 | 规则 | 证据 |
| --- | --- | --- |
| 绝对阻断（任何来源） | `169.254.169.254`、`fd00:ec2::254`、`0.0.0.0/8`、`::`、`224.0.0.0/4`、`240.0.0.0/4`、`255.255.255.255`、`ff00::/8`、`fec0::/10` | `target.ts:45-61` |
| 严格阻断（仅请求头来源） | `127.0.0.0/8`、`::1`、`169.254.0.0/16`、`fe80::/10` | `target.ts:64-73`、`:111` |
| 可信来源判定 | `trusted = fromEnv \|\| config.allowLoopback` | `target.ts:191` |
| 显式白名单优先 | `TECHNITIUM_ALLOWED_TARGETS` 非空时按 `host:port` 或裸主机名匹配，宽松守卫失效 | `target.ts:183-189`；`.env.example:8-12` |
| 地址走私防护 | `::ffff:a.b.c.d` 与 NAT64 `64:ff9b::/96` 先解包为 IPv4 再校验 | `target.ts:82-105` |
| 二次解析投毒防护 | 主机名的**全部** A/AAAA 记录都必须通过；第一个通过的成为 `pinnedAddress` | `target.ts:219-234` |
| RFC1918/ULA 刻意放行 | 内网私有地址不在任何阻断表中——DNS 服务器通常就在内网 | `target.ts:15-17` 注释 + 两张表未包含 `10/8`、`172.16/12`、`192.168/16`、`fc00::/7` |
| Host 头与 SNI 保全 | URL 保留真实主机名，不替换为 pinnedAddress；固定在 socket 层实施 | `target.ts:240-254` 注释 + `forward.ts:15-19` |

置信度 high（全部为直接代码证据）。

---

## 5. L3 浏览器端组件

| 节点 ID | 文件 | 关键证据行 | 置信度 |
| --- | --- | --- | --- |
| `consoleShellC` | `components/app/console-shell.tsx` | `:16-30` 客户端守卫的理由；`:40-45` 未登录跳转带 `?next=`；`:60-80` 传输失败重试面板；`:82-83` 权限判定 | high |
| `loginFormC` | `components/auth/login-form.tsx` | `:72-77` `?next=` 只接受同源相对路径；`:100-110` `applyServer` 同步设定目标；`:128-145` 口令 + TOTP 两段；`:148-184` 令牌模式直连 `/api/auth/token` | high |
| `sessionCtx` | `lib/auth/session.tsx` | `:11-21` 以 `user/session/get` 为真相源；`:49-59` 查询键含 target、`placeholderData` 防白屏；`:65-95` `canView/canModify/canDelete` | high |
| `serversCtx` | `lib/servers/provider.tsx` | `:19-30` env 默认档以"不发头"寻址；`:84` `ready = useMounted()`；`:98-100` `setActiveTarget`；`:157-181` `selectByUrl` 同步生效 | high |
| `queryProviderC` | `components/app/query-provider.tsx` | `:8-36` 为何必须 `setQueryData(key, null)` 而非 `removeQueries`；`:38-51` `dropSession` 只清该 target；`:57-85` retry 策略 | high |
| `sdkDomains` | `lib/api/domains/*.ts` | 13 个文件均以 `import { apiRequest } from '../client'` 开头（grep 全量确认）；`domains/zones.ts:17-23` 记录上游怪异之处 | high |
| `sdkClient` | `lib/api/client.ts` | `:20-42` `activeTarget` 模块级状态；`:70-129` `apiRequest`；`:223-240` 多值参数以逗号连接；`:138-183` 下载走 blob | high |
| `navModel` | `lib/nav.ts` | `:19-26` 数据而非 JSX，三处共用；`:50-92` 6 个分区；`:119-125` `landingRoute`；`:131-139` 最长前缀匹配 | high |
| `moduleViews` | `components/<module>/*.tsx` | 12 个业务目录枚举（account/admin/apps/dashboard/dhcp/dnssec/filtering/logs/records/resolve/settings/zones）；`/cache` 页复用 `components/filtering/domain-tree.tsx`，无独立目录；`docs/page-patterns.md:7-18` 规定 `page.tsx` 为薄壳 | high |
| `uiKit` | `components/ui/*`、`components/app/*`、`components/charts/*` | 32 个 ui 文件（含 `button-variants.ts` 等非组件模块）；`components/app/data-table.tsx:111`/`:465`（`DataTable` + `textColumn`）；`docs/ui-conventions.md:29-42` | high |

### 5.1 权限门控的单点声明

`lib/nav.ts:28-42` 的 `NavItem` 同时携带 `section: PermissionSection` 与 `flag: keyof PermissionFlags`。
三个消费者读同一份数据：侧边栏可见性（`:111-116` `visibleSections`）、路由守卫（`:142-145` `requiredSectionFor` → `console-shell.tsx:82-83`）、登录后落地页（`:119-125` `landingRoute` → `app/page.tsx:27`、`login-form.tsx:83`）。
分区名取自 Technitium 自身命名（`Dashboard`/`Zones`/`Cache`/`Allowed`/`Blocked`/`Logs`/`DhcpServer`/`Apps`/`Settings`/`Administration`/`DnsClient`，见 `docs/page-patterns.md:84-86`）。
置信度 high。

### 5.2 多服务器隔离

每个 TanStack Query 键的首元素是活动目标（`lib/api/query-keys.ts:12-20` 及 `provider.tsx:218-221` `useTargetKey`），因此切换服务器不会显示另一台的缓存行。Cookie 名按 origin 派生（`cookies.ts:33-36`），因此多服务器令牌并存。两处机制独立但目标一致。置信度 high。

---

## 6. 关键关系（边）证据

| 边 | 类型 | 证据 | 置信度 |
| --- | --- | --- | --- |
| `browserApp → nextServer` | runtime-call (HTTP) | `client.ts:107-114` `fetch(url.pathname + url.search, {credentials:'same-origin'})` | high |
| `nextServer → technitium` | runtime-call (HTTP) | `forward.ts:154-162` `undiciFetch` | high |
| `proxyRoute → kernel` | runtime-call | `route.ts:1`、`:24`、`:29` | high |
| `kernel → registry` | compile-time + runtime lookup | `kernel.ts:2`、`:67`、`:76` | high |
| `sdkClient → registry` | compile-time | `client.ts:3`、`:71`、`:79` | high |
| `sdkClient → proxyRoute` | runtime-call (HTTP) | `client.ts:15`（`PROXY_BASE='/api/dns'`）、`:85` | high |
| `loginFormC → tokenRoute` | runtime-call (HTTP) | `login-form.tsx:166-172` 直接 `fetch('/api/auth/token')` | high |
| `tokenRoute → kernel` | compile-time（仅取 `TARGET_HEADER` 常量） | `app/api/auth/token/route.ts:6` | high |
| `queryProviderC → sessionCtx` | runtime（经由 query cache，非直接 import） | `query-provider.tsx:39-51`；`session.tsx:58` `placeholderData` 使 `null` 成为唯一可通知的写入 | high |
| `transport → targetGuard` | compile-time（type-only） | `forward.ts:4` `import type { ProxyTarget }` | high |
| `serversCtx → sdkClient` | runtime-call | `provider.tsx:4`、`:99`、`:162`、`:170`、`:175` | high |
| `i18nRequest → messagesBundle` | runtime-call | `lib/i18n/request.ts:4`、`:36` | high |
| `gen-registry.mjs → registry` | 生成（构建期） | `registry.ts:1-2` 头部标注 AUTO-GENERATED；`scripts/probe/gen-registry.mjs:1-27` | high |
| `audit-coverage.mjs → {probe_js, registry, sdkDomains}` | 门禁（构建期） | `scripts/audit-coverage.mjs:27-50`；实际运行输出 `upstream 129 · registry 129 · called by the SDK 128` | high |

### 6.1 已验证的层间边界（负向证据）

**`lib/proxy/*` 是服务端专属**：全仓 grep `from '(@/lib/proxy…|\./proxy…|\.\./proxy…)'` 共 19 处命中，其中生产代码仅 2 处 —— `app/api/dns/[...path]/route.ts:1` 与 `app/api/auth/token/route.ts:2-6`；其余 13 处全在 `tests/node/*`。`components/**` 与 `lib/api/client.ts` 零命中。置信度 high。

**该边界靠约定而非机制强制**：`package.json:29-64` 未包含 `server-only` 包，`lib/proxy/*` 也没有 `import 'server-only'` 哨兵。因此"客户端组件不得导入代理层"目前由 `docs/ui-conventions.md:36`（"lib/api/ never import into layout chrome"）与代码评审维系，构建期不会失败。置信度 high（对"未强制"这一事实）；此处的**可强制性**属 `unknown`，需实际引入 `server-only` 后验证。

**`components/ui/*` 不依赖 API 层**：`docs/ui-conventions.md:29-39` 规定分层；抽查 `components/app/console-shell.tsx:9-14` 只导入 `layout/`、`ui/`、`lib/auth`、`lib/nav`，未导入 `lib/api/domains`。置信度 medium（仅抽查一个文件，未对 32 个 ui 文件做穷举 grep）。

---

## 7. 配置面（运行时开关）

| 变量 | 读取位置 | 文档位置 | 一致性 |
| --- | --- | --- | --- |
| `TECHNITIUM_API_URL` | `lib/proxy/target.ts:125`；`app/layout.tsx:44` | `README.md:159`、`.env.example:6` | 一致 |
| `TECHNITIUM_ALLOWED_TARGETS` | `lib/proxy/target.ts:126-129` | `README.md:160`、`.env.example:8-12` | 一致 |
| `PROXY_TIMEOUT_JSON_MS` | `lib/proxy/forward.ts:29` | `README.md:162`、`.env.example:18` | 一致 |
| `PROXY_TIMEOUT_FILE_MS` | `lib/proxy/forward.ts:30` | `README.md:163`、`.env.example:19` | 一致 |
| `PROXY_AUDIT_LOG` | `lib/proxy/audit.ts:80` | `README.md:164`、`.env.example:22` | 一致 |
| `PROXY_ALLOW_LOOPBACK` | `lib/proxy/target.ts:130` | **README 与 .env.example 均未记录**（仅 `tests/node/proxy-target.test.ts:110-127` 覆盖） | **文档缺失**（high confidence，grep 全仓 `.ts/.tsx/.mjs/.js` 确认） |
| `SESSION_COOKIE_PREFIX` | **代码中无任何读取**（grep 全仓 0 命中）；前缀在 `lib/proxy/cookies.ts:21` 硬编码为 `'tdns_t_'` | `README.md:161`、`.env.example:14-15` 声称可配置并要求生产环境用随机值加固 | **文档与实现不符**（high confidence） |
| `E2E_*` | `tests/e2e/env.ts`（经 `playwright.config.ts:2`） | `README.md:165`、`.env.example:24-30` | 一致，且明确标注应用运行时不读取 |
| `NODE_ENV` | `lib/proxy/envelope.ts:83`、`lib/proxy/audit.ts:109` | — | 框架内置 |

安全响应头（`X-Content-Type-Options: nosniff`、`X-Frame-Options: DENY`、`Referrer-Policy: strict-origin-when-cross-origin`）在 `next.config.ts:15-26` 对 `/:path*` 全局注入；`poweredByHeader: false`（`:8`）。置信度 high。

---

## 8. 测试与门禁拓扑

| 层 | 配置 | 证据 |
| --- | --- | --- |
| Vitest 双 project 拆分 | `tests/node/**` 用 `environment: 'node'`，`tests/dom/**` 用 `jsdom` + `@vitejs/plugin-react` | `vitest.config.mts:5-17` 注释解释原因：jsdom 会用不兼容实现遮蔽 `Blob`/`File`/`FormData`，导致传输测试出现与被测代码无关的失败 |
| 覆盖率范围 | `include: ['lib/**','components/**']`，`exclude` 掉生成物 `lib/api/registry.ts` 与 `lib/api/types/**` | `vitest.config.mts:48-55`（理由：断言生成物内容等于重复 `gen-registry.mjs`） |
| 未处理拒绝 | `dangerouslyIgnoreUnhandledErrors: false` | `vitest.config.mts:44-47` |
| E2E 串行 | `workers: 1`、`fullyParallel: false` | `playwright.config.ts:10-12` 注释：两个 worker 在同一台真实服务器上创建/删除区域会互相清理夹具 |
| E2E 打真实服务器 | `webServer` 启 `next start`（生产构建，非 dev） | `playwright.config.ts:13-14`、`:60-67`；`.env.example:24-30` |
| E2E 引擎覆盖 | chromium 全量 + firefox 仅 `navigation.spec.ts` 冒烟 | `playwright.config.ts:46-58` |
| 完整门禁 | `i18n:check → i18n:usage → audit:coverage → audit:params → typecheck → lint → test → build` | `package.json:25`；`README.md:187-191` |

代理层的单测覆盖逐模块对应：`proxy-kernel` / `proxy-target` / `proxy-forward` / `forward-pinning` / `proxy-envelope` / `proxy-errors` / `proxy-cookies` / `proxy-audit` / `registry` / `api-client` / `api-errors` / `nav` / `servers-store` / `url`。
其中 `tests/node/forward-pinning.test.ts` 专门覆盖 `pinnedLookup` —— `forward.ts:49-51` 注释指出该回调本身就是 DNS 重绑定防御，而 mock 掉 undici `fetch` 的测试看不见它。置信度 high。

---

## 9. 假设（human-assumption）

以下为模型中标注为假设、非代码直接证据的判断：

1. **`browserApp` 与 `nextServer` 被建模为两个 container**，尽管它们同属一个 `next start` 进程。理由：二者是不同的执行环境（浏览器 JS 引擎 vs Node），拥有不同的信任级别（令牌对前者不可见、对后者可见），且分别有独立的组件视图。这是 C4 对 SPA + 后端的常见建模选择，属**建模决策**而非代码事实。置信度：assumption（合理但可争议）。
2. **`sharedContract` 被提升为 container**，而非归入 `nextServer`。理由：`registry.ts` 与 `errors.ts` 被两侧同时编译，把它画进任一侧都会误导信任边界。同为建模决策。置信度：assumption。
3. **运维人员的具体角色分工未知**：代码只体现 Technitium 自身的 11 个权限分区，本仓库没有独立的用户/角色/租户模型。是否有多团队、审批流或职责分离需求 —— `unknown`。

---

## 10. 未知与验证任务

| # | 未知项 | 为何未知 | 验证方式 |
| --- | --- | --- | --- |
| U1 | **运行时部署拓扑** | 仓库无 `Dockerfile`、无 `.github/workflows`、无任何 IaC（已用 `Get-ChildItem -Recurse -Include Dockerfile,*.yml,*.yaml` 确认，仅命中 `pnpm-lock.yaml` / `pnpm-workspace.yaml`）。已知信息止于 `pnpm dev` / `pnpm start` 监听 5390（`package.json:7-9`）。反向代理、TLS 终止、进程守护、多实例、`X-Forwarded-Proto` 的实际来源均为空白。 | 需要运维侧信息；若后续要建模，路由到 `deployment-topology-analyzer` |
| U2 | **`isSecureRequest` 对反代的依赖** | `kernel.ts:240-244` 与 `token/route.ts:24-27` 读 `x-forwarded-proto` 决定是否加 `Secure`。谁设置该头、是否会被客户端伪造，取决于未记录的反代配置。 | 与 U1 一并验证；检查部署环境是否在入口剥离客户端传入的 `X-Forwarded-Proto` |
| U3 | **`activeTarget` 的模块级可变状态** | `client.ts:20` 是模块作用域的 `let`，由 `serversCtx` 的 effect 写入（`provider.tsx:98-100`）。`login-form.tsx:100-110` 的注释明确指出 React state 在下一次渲染前不可见，故 `selectByUrl` 必须同步调 `setActiveTarget`。是否还存在其他"effect 尚未运行但请求已发出"的窗口，未做穷举验证。 | 审查所有在 `serversCtx.ready === false` 期间可能触发请求的路径 |
| U4 | **`components/ui/*` 对 API 层的零依赖** | 仅抽查了 `console-shell.tsx`，未对 32 个 ui 文件做穷举 grep。 | `rg "from '@/lib/api" components/ui components/app components/charts` |
| U5 | **上游版本漂移的检测时机** | 注册表源自 v15.4 控制台 JS 快照（`.probe/console-js/`，12 个文件）。`envelope.ts:83-85` 的自愈与 `errors.ts:71-79` 的 `bad_upstream_response` 是运行时兜底，但何时该重新 probe 没有自动触发机制。 | 检查是否需要在 CI 中对目标服务器周期性跑 `pnpm probe` + `audit:coverage` |
| U6 | **`TRANSFORMS` 空表的未来契约** | `envelope.ts:23-29` 声明该 hook 刻意留空，转换应放在 SDK 层。这是一个尚未被任何实例验证的约定。 | 下次遇到"上游形状对 UI 敌意"的端点时，确认实现落在 `lib/api/domains/*` 而非 `TRANSFORMS` |
| U7 | **SCM 状态** | `git log` 报 `fatal: your current branch 'main' does not have any commits yet`；`git status --short` 显示全部文件为 `??`（未跟踪）。因此**无法从提交历史推断模块演进、所有权或变更热点**，本模型的 owner 字段全部为空。 | 首次提交后，`dependency-impact-analyzer` 与 `evolution-planner` 才有变更基线可用 |

---

## 11. 证据类型分布

| 证据类型 | 占比情况 |
| --- | --- |
| `code` | 主体。全部节点与关系均由逐文件读取的 import 语句与实现支撑 |
| `config` | `package.json`、`next.config.ts`、`.env.example`、`vitest.config.mts`、`playwright.config.ts` |
| `runtime` | 两项：`node scripts/audit-coverage.mjs` 的实际输出；行数/文件数统计 |
| `document` | `README.md`、`docs/api-endpoints.md`、`docs/page-patterns.md`、`docs/ui-conventions.md` |
| `contract` | `lib/api/registry.ts` 本身即上游 API 面的机器可读契约（生成物） |
| `data` | 无数据库；仅浏览器侧 Cookie 与 localStorage 两处存储 |
| `human-assumption` | 3 项，见第 9 节 |

**负向证据**（"某处不存在"）已明确记录于 §6.1（`server-only` 缺失）与 §10 U1（部署配置缺失），因为二者都会影响读者对模型完整性的判断。
