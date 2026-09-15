import { describe, expect, it, vi, afterEach } from 'vitest'
import {
  classifyOutcome,
  ConsoleAuditSink,
  MemoryAuditSink,
  MultiAuditSink,
  setAuditSink,
  writeAudit,
  type AuditEntry,
  type AuditSink,
} from '@/lib/proxy/audit'

/**
 * The audit trail answers "who changed what, against which server, did it work".
 * It is deliberately narrow: no request bodies, no query values, no tokens. Two
 * invariants matter enough to test:
 *
 *  1. **No secrets leak into the log line.** A grep over logs must never turn up a
 *     credential or a request body.
 *  2. **Audit failure never breaks a request.** A sink that throws (full disk,
 *     closed stream) is swallowed — losing an audit line is better than turning a
 *     successful proxied call into a 500.
 */

class CaptureSink implements AuditSink {
  readonly entries: AuditEntry[] = []
  write(entry: AuditEntry): void {
    this.entries.push(entry)
  }
}

class ThrowingSink implements AuditSink {
  write(): void {
    throw new Error('audit disk on fire')
  }
}

const SECRET_SAMPLES = ['Bearer super-secret-token', 'hunter2', 'tdns_t_abc=deadbeef', 'password=letmein']

afterEach(() => {
  setAuditSink(undefined)
  vi.restoreAllMocks()
})

describe('ConsoleAuditSink', () => {
  it('writes a single greppable line with the core fields', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    new ConsoleAuditSink().write({
      ts: '2026-01-01T00:00:00.000Z',
      endpoint: 'zones/list',
      domain: 'zones',
      method: 'GET',
      target: 'http://127.0.0.1:5380',
      httpStatus: 200,
      durationMs: 12,
      outcome: 'ok',
    })
    expect(info).toHaveBeenCalledTimes(1)
    const line = info.mock.calls[0][0] as string
    expect(line).toContain('[audit]')
    expect(line).toContain('GET')
    expect(line).toContain('zones/list')
    expect(line).toContain('http://127.0.0.1:5380')
    expect(line).toContain('200')
    expect(line).toContain('12ms')
    expect(line).toContain('ok')
  })

  it('appends the code only when one is present', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    const sink = new ConsoleAuditSink()
    sink.write({ ts: 't', endpoint: 'status', domain: 'system', method: 'GET', target: '-', httpStatus: 200, durationMs: 1, outcome: 'ok' })
    expect(info.mock.calls[0][0] as string).not.toContain('code=')
    sink.write({ ts: 't', endpoint: 'status', domain: 'system', method: 'GET', target: '-', httpStatus: 401, durationMs: 1, outcome: 'auth', code: 'invalid_token' })
    expect(info.mock.calls[1][0] as string).toContain('code=invalid_token')
  })

  it('never emits credentials, cookies or request bodies', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    new ConsoleAuditSink().write({
      ts: '2026-01-01T00:00:00.000Z',
      endpoint: 'user/login',
      domain: 'user',
      method: 'POST',
      target: 'http://127.0.0.1:5380',
      httpStatus: 200,
      durationMs: 5,
      outcome: 'ok',
    })
    const line = info.mock.calls[0][0] as string
    for (const sample of SECRET_SAMPLES) expect(line).not.toContain(sample)
  })
})

describe('writeAudit', () => {
  it('stamps ts and derives outcome, then forwards to the configured sink', () => {
    const capture = new CaptureSink()
    setAuditSink(capture)
    writeAudit({ endpoint: 'zones/list', domain: 'zones', method: 'GET', target: 'http://127.0.0.1:5380', httpStatus: 200, durationMs: 7 })
    expect(capture.entries).toHaveLength(1)
    const entry = capture.entries[0]
    expect(entry.outcome).toBe('ok')
    expect(typeof entry.ts).toBe('string')
    expect(Number.isNaN(Date.parse(entry.ts))).toBe(false)
  })

  it('records a code on a failing call', () => {
    const capture = new CaptureSink()
    setAuditSink(capture)
    writeAudit({ endpoint: 'zones/list', domain: 'zones', method: 'GET', target: '-', httpStatus: 401, durationMs: 1, code: 'invalid_token' })
    expect(capture.entries[0]).toMatchObject({ code: 'invalid_token', outcome: 'auth', httpStatus: 401 })
  })

  it('carries only the narrow documented field set', () => {
    const capture = new CaptureSink()
    setAuditSink(capture)
    writeAudit({ endpoint: 'status', domain: 'system', method: 'GET', target: '-', httpStatus: 200, durationMs: 1 })
    const serialised = JSON.stringify(capture.entries[0])
    for (const sample of SECRET_SAMPLES) expect(serialised).not.toContain(sample)
    expect(Object.keys(capture.entries[0]).sort()).toEqual(['domain', 'durationMs', 'endpoint', 'httpStatus', 'method', 'outcome', 'target', 'ts'])
  })

  it('does not throw when an underlying sink fails', () => {
    const capture = new CaptureSink()
    setAuditSink(new MultiAuditSink([new ThrowingSink(), capture]))
    expect(() =>
      writeAudit({ endpoint: 'zones/list', domain: 'zones', method: 'GET', target: '-', httpStatus: 200, durationMs: 1 }),
    ).not.toThrow()
    // the healthy sink still receives the entry even though its sibling threw
    expect(capture.entries).toHaveLength(1)
  })
})

describe('classifyOutcome', () => {
  it('maps auth codes to the auth outcome', () => {
    expect(classifyOutcome(401, 'invalid_token')).toBe('auth')
    expect(classifyOutcome(401, 'missing_token')).toBe('auth')
    expect(classifyOutcome(428, 'two_factor_required')).toBe('auth')
  })

  it('maps proxy faults to proxy_error', () => {
    expect(classifyOutcome(403, 'blocked_target')).toBe('proxy_error')
    expect(classifyOutcome(502, 'upstream_unreachable')).toBe('proxy_error')
    expect(classifyOutcome(504, 'upstream_timeout')).toBe('proxy_error')
    expect(classifyOutcome(400, 'no_target')).toBe('proxy_error')
  })

  it('maps other codes to upstream_error', () => {
    expect(classifyOutcome(400, 'upstream_error')).toBe('upstream_error')
  })

  it('falls back to the http status when no code is given', () => {
    expect(classifyOutcome(200)).toBe('ok')
    expect(classifyOutcome(400)).toBe('upstream_error')
  })
})

describe('MemoryAuditSink', () => {
  it('caps the ring buffer at its limit', () => {
    const sink = new MemoryAuditSink(2)
    for (let i = 0; i < 5; i++) {
      sink.write({ ts: 't', endpoint: 'status', domain: 'system', method: 'GET', target: '-', httpStatus: 200, durationMs: i, outcome: 'ok' })
    }
    expect(sink.all()).toHaveLength(2)
    expect(sink.all().map((e) => e.durationMs)).toEqual([3, 4])
  })
})
