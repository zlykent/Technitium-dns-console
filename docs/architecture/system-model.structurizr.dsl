workspace "Technitium DNS Console" "当前态 C4 架构模型。证据来源见同目录 system-model.evidence.md；范围仅限 current state，不含目标态与运行时部署拓扑。" {
    !identifiers hierarchical

    model {
        operator = person "DNS 运维管理员" "通过浏览器使用控制台，管理一台或多台 Technitium DNS Server 的区域、记录、DNSSEC、过滤、日志、DHCP、应用与权限。"

        technitium = softwareSystem "Technitium DNS Server" "上游 DNS 服务器（本仓库对齐 v15.4）。暴露 129 个 form-encoded HTTP 管理端点，几乎全部返回 HTTP 200，真实结果由响应体的 status 字段表达。" {
            tags "External"
        }

        console = softwareSystem "Technitium DNS Console" "本仓库。一个 Next.js 16 应用，由浏览器端控制台与服务端代理两个运行面组成。自身不持有任何 DNS 数据，只转发；全部状态存在于上游服务器与浏览器。" {

            browserApp = container "浏览器端控制台" "React 19 客户端组件树。承载会话/权限上下文、多服务器切换、TanStack Query 缓存、导航守卫与 12 个业务模块视图。所有路由页面都是 Server Component 薄壳，只负责挂载它。" "React 19 / TanStack Query v5 / TanStack Table v8 / react-hook-form + zod / Tailwind CSS v4 / recharts" {

                consoleShellC = component "控制台外壳 + 客户端路由守卫" "守卫刻意放在客户端：权限图来自针对‘浏览器当前选中的那台服务器’的 user/session/get，而该选择只存在于 localStorage。三种出口：未登录→/login?next=，缺权限→权限面板，传输失败→重试面板（绝不静默跳转）。" "components/app/console-shell.tsx"
                loginFormC = component "登录表单" "单表单三模式：口令、口令+TOTP（上游以 2fa-required 应答触发第二段）、粘贴长效 API 令牌。?next= 只接受同源相对路径以防开放重定向。" "components/auth/login-form.tsx"
                sessionCtx = component "会话与权限上下文" "以 user/session/get 为唯一真相源（令牌在 httpOnly Cookie 中，浏览器无法自行判断是否登录）。查询键以活动目标打头，切换服务器即自动重新鉴权。暴露 canView/canModify/canDelete 与 PermissionGate。" "lib/auth/session.tsx"
                serversCtx = component "多服务器上下文" "维护服务器档案列表与 activeId。关键约定：env 默认档通过‘完全不发送 X-Dns-Target 头’寻址，从而被代理视为可信来源并放行回环地址。ready 在 localStorage 水合前为 false，避免首个请求打到错误的服务器。" "lib/servers/provider.tsx + lib/servers/store.ts"
                queryProviderC = component "查询客户端 + 全局 401 处理" "任一查询或变更返回 401 时，把该 target 的 session 缓存 setQueryData 为 null（不是 removeQueries，那样观察者不会被通知），触发守卫跳转，并清除该 target 的其余缓存；其他 target 的会话保持不动。" "components/app/query-provider.tsx"
                sdkDomains = component "类型化域 SDK" "13 个域模块（system/user/admin/dashboard/zones/records/dnssec/filtering/logs/dhcp/apps/settings/dnsClient），封装参数与返回类型。应用代码从不直接书写端点 id。" "lib/api/domains/*.ts"
                sdkClient = component "浏览器 API 客户端" "构造 /api/dns/<endpoint> URL、按 Technitium 期望编码参数（多值以逗号连接为单值）、把非 2xx 响应体解析回 DnsApiError。下载走 blob 流而非官方控制台的 ?token= 单次令牌 URL。" "lib/api/client.ts"
                navModel = component "导航与权限分区模型" "声明式数据而非 JSX：侧边栏可见性、路由守卫、登录后落地页三者读同一份配置，使‘隐藏菜单’与‘拦截页面’成为同一个决定。最长前缀匹配保证 /zones/[zone]/dnssec 高亮 Zones。" "lib/nav.ts"
                moduleViews = component "业务模块视图" "12 个业务目录下的 'use client' 页面视图与对话框：account / admin / apps / dashboard / dhcp / dnssec / filtering / logs / records / resolve / settings / zones。目录与页面不是一一对应：filtering 同时服务 /allowed 与 /blocked，logs 同时服务 /logs 与 /system-logs，/cache 页复用 filtering/domain-tree.tsx 而无独立目录。" "components/<module>/*.tsx"
                uiKit = component "UI 基元与跨页构件" "components/ui 下 32 个文件（含 button-variants.ts 等非组件模块）：shadcn 风格 Radix 基元，每文件一个组件，函数声明 + 具名导出，不用 forwardRef；另有 DataTable / PageShell / ConfirmDialog / States 等跨页构件与 recharts 封装。" "components/ui/*, components/app/*, components/charts/*"
            }

            nextServer = container "Next.js 服务端" "App Router 路由与代理。页面级 Server Component 不含逻辑；两个 Route Handler 承载全部上游通信与安全策略。代理内核只依赖 Web Request/Response API，因此无需启动 Next 即可单测。" "Next.js 16 (runtime = nodejs, force-dynamic) / Node >= 20.9 / undici 8" {

                proxyRoute = component "catch-all 代理路由壳" "GET|POST /api/dns/<endpoint> → <target>/api/<endpoint>。刻意做成薄壳：只解包 params 并委派，maxDuration=300 以免大文件被平台缓冲。" "app/api/dns/[...path]/route.ts"
                tokenRoute = component "API 令牌领养路由" "POST/DELETE /api/auth/token。验证优先：先用粘贴的令牌调 user/session/get，成功后才写 Cookie，并在响应中剥除 token 字段。" "app/api/auth/token/route.ts"
                kernel = component "代理内核（10 步管线）" "1 取目标 2 SSRF 校验+DNS 解析 3 固定 IP 4 取该 origin 的令牌 Cookie 5 端点白名单+方法白名单 6 原样转发并注入 Bearer 7 按 kind 超时 8 翻译四种 status 9 拆信封或流式透传 10 写一行审计。单一错误出口保证审计与响应形状一致。" "lib/proxy/kernel.ts"
                targetGuard = component "目标解析 + SSRF 守卫" "双层 BlockList：绝对阻断（云元数据 169.254.169.254 / fd00:ec2::254、组播、保留、未指定）与严格阻断（回环、链路本地，仅对请求头来源生效）。IPv4-mapped 与 NAT64 先解包再校验；主机名的全部解析结果都须通过；TECHNITIUM_ALLOWED_TARGETS 非空时优先于宽松守卫。" "lib/proxy/target.ts"
                transport = component "上游传输 + IP 固定" "undici Agent 的 connect.lookup 钩子只回答 resolveTarget 已校验的那个地址，使二次 DNS 应答无法换入内网 IP；URL 保留真实主机名以维持 Host 头与 TLS SNI。dispatcher 按 协议|IP|族 缓存（上限 16，粗略 LRU）。超时按 kind 分流：JSON 30s / file+upload 120s。" "lib/proxy/forward.ts"
                statusTranslate = component "上游状态翻译" "把 ok / invalid-token / 2fa-required / error 四种 status，以及非 JSON 响应（captive portal、反代错误页、版本不匹配）翻译成 12 个 DnsApiError 码与标准 HTTP 状态。" "lib/proxy/errors.ts"
                envelopeMod = component "信封拆封 + 自愈" "wrapped → body.response；flat → 顶层去掉 status/server。声明与实际不符时自愈而非返回 undefined（猜错会白屏一整页），并在非生产环境告警。TRANSFORMS 刻意留空：转换属于可对着真实夹具单测的 SDK 层。" "lib/proxy/envelope.ts"
                cookieMod = component "Cookie 编解码" "手写 Set-Cookie 序列化（流式响应中无法使用 Next 的 cookies()）。Cookie 名由 sha256(前缀+规范化 origin) 前 12 位派生，因此代理无状态、每台服务器一枚令牌、切换不互相覆盖。" "lib/proxy/cookies.ts"
                auditMod = component "审计日志" "窄记录：ts / endpoint / domain / method / target(仅 origin) / httpStatus / durationMs / outcome / code。刻意不含请求体、查询值与令牌——连可能承载机密的参数名都不枚举。Sink 为接口，可替换为持久化实现；审计失败绝不影响被代理的请求。" "lib/proxy/audit.ts"
                i18nRequest = component "语言协商" "无路径前缀方案：Cookie 为真相源，Accept-Language 仅在首次访问时打破平局，结果写入 <html lang>。切换语言改写 Cookie 并刷新 router，URL 保持稳定可分享。" "lib/i18n/request.ts"
                messagesBundle = component "i18n 文案包" "16 个命名空间 × zh/en，全部静态 import，使拼写错误在构建期失败而不是运行期渲染出裸键。zh 与 en 键树必须完全一致，由 pnpm i18n:check 强制。" "lib/i18n/messages.ts + messages/{zh,en}/*.json"
            }

            sharedContract = container "共享 API 契约（同构）" "被同时编译进浏览器包与 Node 服务端的两个模块。这是本架构最关键的一处约束：代理白名单与 SDK 类型读的是同一个对象，因此二者不可能漂移。" "TypeScript (isomorphic, 无 Node/BOM 依赖)" {
                registry = component "端点注册表" "自动生成的 129 条端点定义（methods / auth / envelope / kind / domain）。一物四用：代理路径白名单、HTTP 方法表、鉴权与信封策略、SDK 的 EndpointId 字面量联合类型。文件头禁止手改。" "lib/api/registry.ts (由 scripts/probe/gen-registry.mjs 生成)"
                errorContract = component "错误契约" "12 个错误码 → HTTP 状态的单一映射表，以及 DnsApiError 类。服务端抛出、浏览器端解析回同一个类，使 UI 代码无需区分失败来自代理还是上游。" "lib/api/errors.ts"
            }

            cookieStore = container "httpOnly 令牌 Cookie" "名称 tdns_t_<sha256(origin) 前 12 位>，Path=/，Max-Age 7 天，SameSite=Lax，HTTPS 请求下附 Secure。页面脚本不可读；登录与会话响应中的 token 字段被剥离，绝不返回给前端 JS。" "浏览器 Cookie jar" {
                tags "Database"
            }

            localStore = container "服务器配置存储" "运维添加的服务器档案 {id,name,url} 与 activeId。仅存地址，不含任何凭据；env 默认档为派生项，从不落盘。JSON 损坏时降级为空存储。" "localStorage: tdns.servers.v1" {
                tags "Database"
            }
        }

        # ---- L1 系统上下文
        operator -> console "管理 DNS 区域/记录/DNSSEC/过滤/日志/DHCP/应用/设置/权限" "HTTPS"
        console -> technitium "转发 129 个管理端点" "HTTP + form-encoded / JSON 信封"

        # ---- L2 容器
        operator -> console.browserApp "使用控制台界面" "HTTPS"
        console.browserApp -> console.nextServer "所有上游调用经由单一 catch-all 代理；浏览器从不直连 DNS 服务器（上游不发 CORS 头，也无法直连）" "same-origin fetch + X-Dns-Target 头"
        console.nextServer -> technitium "原样转发查询串与请求体，注入 Authorization: Bearer" "undici / HTTP"
        console.nextServer -> console.cookieStore "登录成功写入令牌；invalid-token 时删除；登出时删除" "Set-Cookie (httpOnly)"
        console.browserApp -> console.cookieStore "浏览器随 same-origin 请求自动携带；页面脚本不可读" "httpOnly Cookie"
        console.browserApp -> console.localStore "读写服务器档案与 activeId" "localStorage"

        # ---- L3 服务端组件
        console.nextServer.proxyRoute -> console.nextServer.kernel "委派 GET/POST 与 path 数组" "in-process"
        console.nextServer.tokenRoute -> console.nextServer.kernel "复用 TARGET_HEADER 常量" "compile-time dependency"
        console.nextServer.tokenRoute -> console.nextServer.targetGuard "解析并校验目标" "in-process"
        console.nextServer.tokenRoute -> console.nextServer.transport "以粘贴的令牌调用 user/session/get 验证" "in-process"
        console.nextServer.tokenRoute -> console.nextServer.cookieMod "验证通过后才写 Cookie；DELETE 时删除" "in-process"
        console.nextServer.tokenRoute -> console.nextServer.auditMod "写审计行" "in-process"
        console.nextServer.kernel -> console.nextServer.targetGuard "解析目标 + SSRF 校验 + 取得 pinnedAddress" "in-process"
        console.nextServer.kernel -> console.nextServer.cookieMod "读取该 origin 的令牌" "in-process"
        console.nextServer.kernel -> console.nextServer.transport "执行上游调用" "in-process"
        console.nextServer.kernel -> console.nextServer.statusTranslate "翻译上游 status / 非 JSON 响应" "in-process"
        console.nextServer.kernel -> console.nextServer.envelopeMod "拆封成功响应" "in-process"
        console.nextServer.kernel -> console.nextServer.auditMod "单一错误出口统一写审计行" "in-process"
        console.nextServer.kernel -> console.sharedContract.registry "端点白名单、方法白名单、auth/envelope/kind 策略" "compile-time + runtime lookup"
        console.nextServer.kernel -> console.sharedContract.errorContract "抛出 DnsApiError" "compile-time dependency"
        console.nextServer.statusTranslate -> console.nextServer.envelopeMod "读取四个 status 常量与错误文案提取" "compile-time dependency"
        console.nextServer.statusTranslate -> console.sharedContract.errorContract "构造 DnsApiError" "compile-time dependency"
        console.nextServer.transport -> console.nextServer.targetGuard "消费已校验的 pinnedAddress（type-only import）" "compile-time dependency"
        console.nextServer.transport -> console.sharedContract.errorContract "把传输失败映射为 upstream_unreachable / upstream_timeout" "compile-time dependency"
        console.nextServer.transport -> technitium "建立 socket；connect.lookup 只回答已校验 IP" "undici Agent / TCP"
        console.nextServer.targetGuard -> console.sharedContract.errorContract "抛出 no_target / blocked_target / upstream_unreachable" "compile-time dependency"
        console.nextServer.envelopeMod -> console.sharedContract.registry "按 EndpointId 查 TRANSFORMS（type-only）" "compile-time dependency"
        console.nextServer.auditMod -> console.sharedContract.registry "ApiDomain / EndpointId 类型（type-only）" "compile-time dependency"
        console.nextServer.i18nRequest -> console.nextServer.messagesBundle "按 locale 静态装载 16 个命名空间" "in-process"

        # ---- L3 浏览器端组件
        console.browserApp.moduleViews -> console.browserApp.sdkDomains "调用类型化域函数" "in-process"
        console.browserApp.moduleViews -> console.browserApp.uiKit "组合基元与跨页构件" "in-process"
        console.browserApp.moduleViews -> console.browserApp.queryProviderC "useQuery / useMutation，键以 target 打头" "in-process"
        console.browserApp.moduleViews -> console.browserApp.sessionCtx "useCan('<Section>') 门控按钮与页面" "in-process"
        console.browserApp.sdkDomains -> console.browserApp.sdkClient "apiRequest / apiDownload / apiDownloadBlob" "in-process"
        console.browserApp.sdkClient -> console.nextServer.proxyRoute "fetch('/api/dns/<endpoint>')" "same-origin HTTP"
        console.browserApp.sdkClient -> console.sharedContract.registry "读取同一份 ENDPOINTS 定义以校验方法" "compile-time dependency"
        console.browserApp.sdkClient -> console.sharedContract.errorContract "把非 2xx 响应体解析回 DnsApiError" "compile-time dependency"
        console.browserApp.sessionCtx -> console.browserApp.sdkDomains "getSession() / logout()" "in-process"
        console.browserApp.sessionCtx -> console.browserApp.serversCtx "useTargetKey() 作为查询键首元素" "in-process"
        console.browserApp.serversCtx -> console.browserApp.sdkClient "setActiveTarget() 决定是否发送 X-Dns-Target" "in-process"
        console.browserApp.serversCtx -> console.browserApp.localStore "持久化 {profiles, activeId}" "localStorage"
        console.browserApp.consoleShellC -> console.browserApp.sessionCtx "读取 ready / isAuthenticated / permissions / connectionError" "in-process"
        console.browserApp.consoleShellC -> console.browserApp.navModel "requiredSectionFor(pathname) 与 landingRoute(permissions)" "in-process"
        console.browserApp.loginFormC -> console.browserApp.sdkDomains "login({user, pass, totp})" "in-process"
        console.browserApp.loginFormC -> console.browserApp.serversCtx "selectByUrl() 在提交同一 tick 内同步设定目标" "in-process"
        console.browserApp.loginFormC -> console.nextServer.tokenRoute "POST /api/auth/token（绕过 SDK 客户端，需显式设置 X-Dns-Target）" "same-origin HTTP"
        console.browserApp.queryProviderC -> console.browserApp.sessionCtx "任一请求 401 时把 session 缓存置 null 以触发守卫" "in-process (query cache)"
        console.browserApp.queryProviderC -> console.sharedContract.errorContract "isAuthError() 判定" "compile-time dependency"
    }

    views {
        systemContext console "SystemContext" "L1 — 系统边界：谁使用本控制台，它依赖哪一个外部系统。" {
            include *
            autoLayout lr
        }

        container console "Containers" "L2 — 一个 Next.js 进程内的两个运行面、一处同构契约，以及两处浏览器侧存储。" {
            include *
            autoLayout lr
        }

        component console.nextServer "ServerComponents" "L3 — 服务端：两个 Route Handler 薄壳与代理内核的 7 个可独立单测模块。" {
            include *
            autoLayout lr
        }

        component console.browserApp "BrowserComponents" "L3 — 浏览器端：外壳/守卫、三个上下文、两层 SDK、导航模型与模块视图。" {
            include *
            autoLayout tb
        }

        component console.sharedContract "SharedContract" "L3 — 跨越信任边界被双方共享的注册表与错误契约。" {
            include *
            autoLayout lr
        }

        styles {
            element "Person" {
                shape person
                background #08427b
                color #ffffff
            }
            element "External" {
                background #6b7280
                color #ffffff
            }
            element "Database" {
                shape cylinder
                background #4b5563
                color #ffffff
            }
            element "Container" {
                background #1168bd
                color #ffffff
            }
            element "Component" {
                background #85bbf0
                color #000000
            }
        }
    }
}
