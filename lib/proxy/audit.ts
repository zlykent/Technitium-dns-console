import type { ApiDomain, EndpointId } from '@/lib/api/registry'

/**
 * Audit trail for proxied calls.
 *
 * The point is answering "who changed what, against which server, and did it
 * work" — not debugging payloads. So the record is deliberately narrow: no
 * request bodies, no query values, no tokens. Parameters that could carry a
 * secret even as a *name* are never enumerated.
 */

export interface AuditEntry {
  /** ISO-8601 timestamp. */
  ts: string
  endpoint: EndpointId
  domain: ApiDomain
  method: string
  /** Origin only — never a path, query string or credential. */
  target: string
  httpStatus: number
  durationMs: number
  outcome: 'ok' | 'upstream_error' | 'auth' | 'proxy_error'
  /** Upstream error code when `outcome` is not `ok`. */
  code?: string
}

/**
 * Sink interface so tests can capture entries and production can swap in a
 * durable store without touching the proxy.
 */
export interface AuditSink {
  write(entry: AuditEntry): void
}

export class ConsoleAuditSink implements AuditSink {
  write(entry: AuditEntry): void {
    const { ts, endpoint, method, target, httpStatus, durationMs, outcome, code } = entry
    const suffix = code ? ` code=${code}` : ''
    // single line, greppable, fixed key order
    console.info(`[audit] ${ts} ${method} ${endpoint} -> ${target} ${httpStatus} ${durationMs}ms ${outcome}${suffix}`)
  }
}

/** In-memory sink for tests and for the `/api/audit` debug view in dev. */
export class MemoryAuditSink implements AuditSink {
  private readonly entries: AuditEntry[] = []

  constructor(private readonly limit = 500) {}

  write(entry: AuditEntry): void {
    this.entries.push(entry)
    if (this.entries.length > this.limit) this.entries.splice(0, this.entries.length - this.limit)
  }

  all(): readonly AuditEntry[] {
    return this.entries
  }

  clear(): void {
    this.entries.length = 0
  }
}

/** Fan-out so dev can log *and* keep a ring buffer. */
export class MultiAuditSink implements AuditSink {
  constructor(private readonly sinks: readonly AuditSink[]) {}

  write(entry: AuditEntry): void {
    for (const sink of this.sinks) {
      try {
        sink.write(entry)
      } catch {
        // an audit failure must never break the proxied request
      }
    }
  }
}

export function isAuditEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = (env.PROXY_AUDIT_LOG ?? 'true').trim().toLowerCase()
  return raw !== 'false' && raw !== '0' && raw !== 'off'
}

/**
 * Classify the outcome for the audit line. Kept separate from the HTTP status
 * because a 400 from Technitium ("zone already exists") is a normal, successful
 * round-trip from the proxy's point of view.
 */
export function classifyOutcome(httpStatus: number, code?: string): AuditEntry['outcome'] {
  if (code === 'invalid_token' || code === 'missing_token' || code === 'two_factor_required') return 'auth'
  if (code) {
    const proxyFaults = new Set(['proxy_error', 'bad_upstream_response', 'upstream_unreachable', 'upstream_timeout', 'no_target', 'blocked_target'])
    if (proxyFaults.has(code)) return 'proxy_error'
    return 'upstream_error'
  }
  return httpStatus < 400 ? 'ok' : 'upstream_error'
}

/** Exposed for the dev-only `/api/audit` endpoint and for tests. */
export const devMemorySink = new MemoryAuditSink()

let sink: AuditSink | undefined

/** Lazily created so importing this module has no side effects in tests. */
export function getAuditSink(): AuditSink {
  if (!sink) {
    const sinks: AuditSink[] = []
    if (isAuditEnabled()) sinks.push(new ConsoleAuditSink())
    if (process.env.NODE_ENV !== 'production') sinks.push(devMemorySink)
    sink = new MultiAuditSink(sinks)
  }
  return sink
}

/** Test hook. Passing `undefined` restores the lazily-built default. */
export function setAuditSink(next: AuditSink | undefined): void {
  sink = next
}

export function writeAudit(entry: Omit<AuditEntry, 'ts' | 'outcome'> & { outcome?: AuditEntry['outcome'] }): void {
  const { outcome, ...rest } = entry
  getAuditSink().write({
    ...rest,
    ts: new Date().toISOString(),
    outcome: outcome ?? classifyOutcome(rest.httpStatus, rest.code),
  })
}
