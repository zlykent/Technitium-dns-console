# 架构说明 — Technitium DNS Console（当前态）

- **产出技能**：`system-modeler`（场景）+ `c4model`（Structurizr DSL 视图）+ `graphviz`（模块依赖图）
- **面向读者**：接手本仓库的开发者、做安全评审的人、需要理解"请求是怎么走到 DNS 服务器的"的运维
- **范围**：仅当前态（current state）。不含目标态、迁移计划、运行时部署拓扑、质量评审与修复建议
- **真相源**：`system-model.structurizr.dsl`。渲染图与本文均为派生物
- **配套**：`system-model.evidence.md`（逐条 sourceRef 与置信度）、`module-map.dot`（模块依赖图源）

---

## 一句话概括

这是 Technitium DNS Server 的**替代 Web 管理界面**：一个 Next.js 16 应用，自身不持有任何 DNS 数据，全部价值在于**把 129 个上游管理端点收敛到单一 catch-all 代理之后，并在这一层集中实施安全策略**；浏览器与上游之间不存在第二条路径。

---

## 系统边界

```
DNS 运维管理员 ──HTTPS──> [ Technitium DNS Console ] ──HTTP/form-encoded──> Technitium DNS Server v15.4
                          （本仓库，唯一在范围内的系统）                    （唯一的外部系统）
```

边界内只有三样东西会持久化，且全部在浏览器侧：

| 存储 | 内容 | 谁能读 |
| --- | --- | --- |
| httpOnly Cookie `tdns_t_<sha256(origin)[:12]>` | 上游会话令牌，每台服务器一枚，7 天 | 只有 Next.js 服务端；页面脚本不可读 |
| localStorage `tdns.servers.v1` | 服务器档案 `{id,name,url}` 与 `activeId` | 页面脚本可读（刻意如此：不含凭据） |
| TanStack Query 内存缓存 | 上游返回的行数据，键以 target 打头 | 当前标签页，刷新即失 |

**没有数据库、没有 ORM、没有迁移。** 这一点对理解本仓库很重要：所有"状态"要么是上游服务器的，要么是浏览器易失的，服务端在请求之间完全无状态——Cookie 名由 origin 派生而非查表，正是为了让代理保持无状态（`lib/proxy/cookies.ts:5-13`）。

---

## 五个容器（L2）

| 容器 | 职责 | 为什么单独成容器 |
| --- | --- | --- |
| **浏览器端控制台** | React 19 组件树：会话/权限、多服务器切换、查询缓存、导航守卫、12 个业务目录的模块视图 | 执行环境与信任级别都与服务端不同——令牌对它不可见 |
| **Next.js 服务端** | 两个 Route Handler + 代理内核 + i18n 协商。页面级 Server Component 全是薄壳 | 唯一能与上游通信、唯一能读令牌的一侧 |
| **共享 API 契约（同构）** | `lib/api/registry.ts` 与 `lib/api/errors.ts` | 被两侧同时编译。把它画进任一侧都会误导信任边界 |
| **httpOnly 令牌 Cookie** | 凭据存储 | 这是本架构的核心信任边界，值得作为一个显式节点 |
| **服务器配置存储** | localStorage 档案 | 多服务器能力的唯一落盘处 |

> 把"浏览器端"与"服务端"拆成两个 container、把同构契约提升为第三个 container，是**建模决策**而非代码事实（见 evidence §9）。同一个 `next start` 进程同时服务这两侧。

---

## 三条最值得先理解的关系

### 1）注册表是唯一真相源，跨信任边界共享

`lib/api/registry.ts` 是**自动生成**的（头部第 1-2 行明写禁止手改，由 `scripts/probe/gen-registry.mjs` 从官方控制台 JS 快照收割）。同一份 129 条定义同时充当四个角色：

- 代理的**路径白名单**（`kernel.ts:67` `isKnownEndpoint`）
- 代理的**HTTP 方法白名单**（`kernel.ts:82` `def.methods.includes`）
- 代理的**策略表**（`auth` 是否要令牌 / `envelope` 是 wrapped 还是 flat / `kind` 决定超时与是否流式）
- SDK 的 **`EndpointId` 字面量联合类型**（`registry.ts:195`）

后果是一个很强的不变式：**代理放行的端点集合与 SDK 能表达的端点集合恒等**，二者不可能漂移。这一点由 `scripts/audit-coverage.mjs` 在门禁中三向比对（上游 JS 快照 vs 注册表 vs SDK 实际调用）。实测输出：

```
upstream 129 · registry 129 · called by the SDK 128
```

唯一的 1 个差值是 `user/createSingleUseToken`，在 `audit-coverage.mjs:43-50` 的 `DELIBERATELY_UNUSED` 里附有书面理由（下载改走代理 blob 流，避免把凭据塞进 URL、浏览器历史与 Referer）。**"我们选择不做"与"我们忘了做"在这个仓库里是可区分的**——这是门禁设计里最不显眼但最有价值的一处。

### 2）浏览器 → 代理 → 上游：单一通道，十步管线

浏览器侧 `lib/api/client.ts` 只会 `fetch('/api/dns/<endpoint>')`（同源，`credentials: 'same-origin'`），并通过 `X-Dns-Target` 头告诉代理打哪台服务器；env 默认档则**完全不发这个头**（`servers/provider.tsx:24-27`），代理因此把目标视为运维可信来源并放行回环地址。

服务端 `lib/proxy/kernel.ts` 的十步管线（每步证据见 evidence §4.1）：

```
1 取目标(X-Dns-Target → env)   2 SSRF 校验 + DNS 解析      3 把已校验 IP 固定进 dispatcher
4 读该 origin 的令牌 Cookie     5 端点白名单 + 方法白名单    6 原样转发 + 注入 Authorization: Bearer
7 按 kind 超时(json 30s/file 120s)  8 四种 status → HTTP 语义  9 拆信封 or 流式透传
10 写一行窄审计
```

两个设计选择值得注意：

- **单一错误出口**（`kernel.ts:303-326`）：所有失败路径都汇到同一个函数，因此审计调用点只有一处、错误响应形状只有一种，浏览器侧 `toApiError` 可以统一解析。
- **文件直通不缓冲**（`kernel.ts:146-156` + `:270-284`）：备份与区域导出可能数百 MB，代理只搬 `upstream.body` 流，并设 `X-Accel-Buffering: no` 让浏览器能显示进度。

### 3）令牌永不出现在脚本可达之处

三重机制（evidence §4.2）：

1. `STRIPS_TOKEN = {user/login, user/session/get}` → 响应体的 `token` 字段被浅拷贝剥除（`kernel.ts:52`、`:259-264`）。
2. 令牌只落 `httpOnly` Cookie，名按 origin 派生，因此多服务器令牌并存不互相覆盖。
3. 下载走代理 blob 流而非官方控制台的 `?token=` 单次令牌 URL。

关键的**例外被显式写下**：`user/createToken` 与 `admin/sessions/createToken` **不**剥离（`kernel.ts:44-51` 注释），因为它们铸造的是运维需要抄下来的新长效令牌。

---

## 服务端组件视图（L3）：代理层的七块可独立单测的模块

```
route.ts (薄壳)  ─┐
                  ├─> kernel.ts ─┬─> target.ts    (SSRF 守卫 + DNS 解析 + 选 IP)
token/route.ts ───┘              ├─> cookies.ts   (sha256 派生 Cookie 名)
   │                             ├─> forward.ts   (undici Agent + connect.lookup 固定 IP)──> 上游
   └─ 直接复用 target/forward/cookies/audit       ├─> errors.ts     (四种 status → 12 个错误码)
                                                 ├─> envelope.ts   (wrapped/flat 拆封 + 自愈)
                                                 └─> audit.ts      (窄记录 + 可替换 Sink)
```

拆分的判据很清晰：**只有 `forward.ts` 触碰 socket**，其余六块都只依赖 Web `Request`/`Response` 与纯函数，因此不需要启动 Next 就能测（`kernel.ts:31-32` 注释）。`vitest.config.mts:5-17` 进一步解释了为何 `tests/node/**` 必须用 `environment: 'node'` 而非 jsdom：jsdom 会用与 undici 不互通的实现遮蔽 `Blob`/`File`/`FormData`，产生与被测代码无关的失败。

### SSRF 守卫的分层（`lib/proxy/target.ts`）

| 层 | 规则 |
| --- | --- |
| 绝对阻断（任何来源） | 云元数据 `169.254.169.254` / `fd00:ec2::254`、组播、保留、未指定、`fec0::/10` |
| 严格阻断（仅请求头来源） | 回环 `127.0.0.0/8` + `::1`、链路本地 `169.254.0.0/16` + `fe80::/10` |
| 地址走私 | `::ffff:a.b.c.d` 与 NAT64 `64:ff9b::/96` **先解包为 IPv4 再校验** |
| 二次解析投毒 | 主机名的**全部** A/AAAA 记录都必须通过；第一个通过的成为 `pinnedAddress` |
| 显式白名单 | `TECHNITIUM_ALLOWED_TARGETS` 非空时优先，宽松守卫失效 |
| 刻意放行 | RFC1918 / ULA 私有空间**不在任何阻断表里**——DNS 服务器通常就在内网 |

IP 固定在 socket 层实施（`forward.ts:52-68` 的 `connect.lookup` 钩子只回答已校验地址），而 URL 保留真实主机名以维持 `Host` 头与 TLS SNI（`target.ts:240-246`）。`forward.ts:49-51` 特别注明：这个回调**本身就是** DNS 重绑定防御，mock 掉 undici `fetch` 的测试看不见它——因此仓库里有一个专门的 `tests/node/forward-pinning.test.ts`。

---

## 浏览器端组件视图（L3）：三个上下文 + 两层 SDK

```
moduleViews (12 个目录)  ──> sdkDomains (13 个域)  ──> sdkClient  ──HTTP──> /api/dns/<endpoint>
      │                                                      │
      ├─> uiKit (32 个 ui 文件 + DataTable/PageShell/…)        └─> registry / errors（同构契约）
      ├─> queryProviderC (useQuery/useMutation + 全局 401)
      └─> sessionCtx (useCan)          consoleShellC ──> sessionCtx + navModel（守卫）
                                       loginFormC    ──> sdkDomains + serversCtx + /api/auth/token
                                       serversCtx    ──> sdkClient.setActiveTarget() + localStorage
```

### 守卫为什么在客户端

`components/app/console-shell.tsx:16-30` 给出了理由，这是本仓库最容易被误解的一处：**令牌确实在服务端可读的 httpOnly Cookie 里，但权限图不在**。权限图来自针对"浏览器当前选中的那台服务器"的 `user/session/get`，而"选中哪台"只存在于 localStorage。在服务端做判断要么复制这份状态，要么让未授权用户先看到页面外壳再被弹走。

守卫有三种出口，都不是静默的：未登录 → `/login?next=<原路径>`；已登录但缺该分区权限 → 权限面板（附一个"你能打开的第一个页面"链接）；传输失败 → 重试面板（`console-shell.tsx:60-80`，注释明写"绝不静默跳转，那会掩盖一台宕掉的服务器"）。

`lib/nav.ts` 把导航做成**数据而非 JSX**，使侧边栏可见性、路由守卫、登录后落地页三者读同一份声明——"隐藏一个菜单项"与"拦截它的页面"是同一个决定，只表达一次。

### 全局 401 的一处非显然细节

`components/app/query-provider.tsx:8-36` 花了一整段注释解释为什么必须 `setQueryData(sessionKey, null)`：

- `clear()` / `removeQueries()` 会让已挂载的观察者继续持有上一个结果——不通知、不重取，守卫永远听不到登出；
- `setQueryData(key, undefined)` 被会话查询自己的 `placeholderData: (previous) => previous`（`session.tsx:58`）吞掉；
- 只有 `setQueryData(key, null)` 会通知：`useSession` 把它读成"探测有答案了：没人登录"，`ready` 翻转，守卫跳转。

并且只清除**失败请求所属 target** 的其余缓存，其他 target 的会话保持不动（它们的 Cookie 仍然有效）。这属于多服务器隔离在缓存层的延伸。

### 多服务器隔离的两处独立机制

1. 每个 TanStack Query 键的**首元素是活动目标**（`lib/api/query-keys.ts:12-20` + `provider.tsx:218-221`），因此切换服务器不会显示另一台的缓存行。
2. Cookie 名按 origin 派生（`cookies.ts:33-36`），因此多台服务器的令牌并存。

会话查询以 target 为键（`session.tsx:50`），切换服务器即自动对那台重新鉴权，无需任何显式 teardown。

---

## 生成链与质量门禁（构建期，不参与运行时）

```
.probe/console-js/ (官方控制台 JS 快照, 12 个文件)
        │
        ├─ scripts/probe/gen-registry.mjs ──> lib/api/registry.ts   [GENERATED]
        │                                └──> docs/api-endpoints.md  [GENERATED]
        │
        └─ scripts/audit-coverage.mjs  (三向比对: upstream vs registry vs SDK)
           scripts/audit-params.mjs
           scripts/check-i18n.mjs + check-i18n-usage.mjs   (zh/en 键树对齐 + 使用率)
           scripts/check-icons.mjs                          (lucide v1.45 改名)
```

完整门禁 `pnpm verify`（`package.json:25`）：
`i18n:check → i18n:usage → audit:coverage → audit:params → typecheck → lint → test → build`

E2E 打**真实服务器**且串行（`playwright.config.ts:10-14`：两个 worker 在同一台服务器上创建/删除区域会互相清理夹具），`webServer` 启的是 `next start` 生产构建而非 dev——注释的理由是"测 dev 构建等于测一个没人会发布的打包配置"。

---

## 证据强度

| 部分 | 强度 | 说明 |
| --- | --- | --- |
| L1 上下文、L2 容器、L3 服务端组件 | **high** | 逐文件读取 import 与实现；每条边都有行级 sourceRef |
| L3 浏览器端组件 | **high** | 同上 |
| 端点计数与 SDK 覆盖率 | **high** | 实际运行 `audit-coverage.mjs` 得到的输出，非文档转述 |
| 代理层的服务端专属性 | **high** | 全仓 grep 负向验证：生产代码只有 2 处导入 `lib/proxy/*`，其余 13 处在 `tests/node/*` |
| `components/ui/*` 对 API 层零依赖 | **medium** | 仅抽查 `console-shell.tsx`，未对 32 个 ui 文件穷举 grep（evidence U4） |
| 运行时部署拓扑 | **unknown** | 见下 |

---

## 模型中已知的留白

以下是**模型的不完整之处**，不是评审意见。需要相应信息才能补齐：

1. **部署拓扑完全未知（U1）**。仓库无 `Dockerfile`、无 CI 工作流、无任何 IaC（已用递归枚举确认）。已知信息止于 `pnpm dev` / `pnpm start` 监听 5390。反向代理、TLS 终止、进程守护、多实例均为空白。若要建模，应路由到 `deployment-topology-analyzer`。
2. **`X-Forwarded-Proto` 的信任来源未知（U2）**。`kernel.ts:240-244` 与 `token/route.ts:24-27` 用它决定是否给 Cookie 加 `Secure`。谁设置该头、入口是否剥离客户端伪造值，取决于未记录的反代配置。与 U1 绑定。
3. **配置面存在两处文档/实现不一致（evidence §7，high confidence）**：
   - `PROXY_ALLOW_LOOPBACK` 被 `target.ts:130` 读取并有测试覆盖，但 README 与 `.env.example` **都未记录**；
   - `SESSION_COOKIE_PREFIX` 在 README 与 `.env.example` 中都被声称可配置（且要求生产用随机值加固），但全仓 grep **无任何代码读取它**——前缀在 `cookies.ts:21` 硬编码为 `'tdns_t_'`。
4. **`activeTarget` 是模块级可变状态（U3）**。`client.ts:20` 的 `let` 由 `serversCtx` 的 effect 写入；`login-form.tsx:100-110` 已经因为"React state 下一次渲染才可见"而必须同步调 `setActiveTarget`。是否还有其他"effect 未跑但请求已发"的窗口，未做穷举验证。
5. **`lib/proxy/*` 的服务端专属性靠约定而非机制强制（evidence §6.1）**。仓库未依赖 `server-only` 包，代理模块里也没有 `import 'server-only'` 哨兵，因此客户端组件误导入代理层不会在构建期失败。
6. **所有权与演进史不可得（U7）**。`git log` 报 `does not have any commits yet`，全部文件为未跟踪状态。因此本模型的 `owner` 字段全空，也无法从提交历史推断模块演进或变更热点。
7. **上游版本漂移无自动触发（U5）**。注册表锚定 v15.4 快照；`envelope.ts:83-85` 的自愈与 `errors.ts:71-79` 的 `bad_upstream_response` 是运行时兜底，但"何时该重新 probe"没有机制约束。

---

## 阅读顺序

1. 想快速建立全局印象 → 用 Qoder 的 **Structurizr DSL 查看器**打开 `system-model.structurizr.dsl`，依次看 `SystemContext` → `Containers` → `ServerComponents` → `BrowserComponents`。
2. 想看密集的模块级依赖与生成链 → 用 Qoder 的 **DOT 查看器**打开 `module-map.dot`（`rankdir=TB`，实线=运行时调用，虚线=编译期依赖，粗线=数据访问）。本机未安装 Graphviz，因此没有随附 SVG 派生物；需要导出时执行 `dot -Tsvg docs/architecture/module-map.dot -o module-map.svg`。
3. 想核实任何一条断言 → `system-model.evidence.md`，每个节点与关系都带 sourceRef 与置信度。
4. 想读代码 → 按这个顺序最省力：`lib/api/registry.ts`（契约）→ `lib/proxy/kernel.ts`（管线）→ `lib/proxy/target.ts` + `forward.ts`（安全核心）→ `lib/api/client.ts`（浏览器侧）→ `lib/auth/session.tsx` + `components/app/console-shell.tsx`（守卫）→ `lib/nav.ts`（权限分区）。
5. 仓库自带的三份约定文档仍然是写代码前的必读：`docs/page-patterns.md`、`docs/ui-conventions.md`、`docs/api-endpoints.md`。

---

## 下一步可以路由到的场景

本模型只回答"这个系统是什么、由哪些部分组成、边界在哪"。更具体的问题应交给对应场景技能：

| 下一个问题 | 路由到 |
| --- | --- |
| 一次登录 / 一次区域导出在系统里怎么流动（含时序与失败分支） | `flow-visualizer` |
| 改动 `registry.ts` 或 `kernel.ts` 会波及哪些模块、测试与页面 | `dependency-impact-analyzer` |
| 这套东西实际怎么部署、TLS 在哪终止、`X-Forwarded-Proto` 谁设 | `deployment-topology-analyzer` |
| 安全模型是否足够、技术债在哪、优先级如何 | `risk-quality-reviewer` |
| 补齐 §7 的文档/实现不一致、决定要不要引入 `server-only` | `evolution-planner` |
| 这些图是否与代码同步（尤其首次提交后） | `architecture-health` |

---

## 维护说明

- **`system-model.structurizr.dsl` 是真相源**。若预览渲染不对，改 DSL，不要手改任何导出的 SVG/PNG。
- 以下变更会让本模型过期，应同步更新：
  - 重新 probe 导致端点数变化（`registry.ts:9` 与 `:202` 的 129）；
  - 新增 `lib/proxy/*` 模块或改变十步管线顺序；
  - 新增 container 级存储（例如引入服务端会话表或持久化审计 Sink——`audit.ts:28-33` 的 `AuditSink` 接口已为此预留）；
  - 引入部署配置（补齐 U1/U2）；
  - 首次 git 提交（补齐 U7 的 owner 与演进维度）。
- 更新后请重跑 `node scripts/audit-coverage.mjs`，把新输出写回 `system-model.evidence.md` §1——本模型的端点计数刻意取自命令输出而非文档转述。
