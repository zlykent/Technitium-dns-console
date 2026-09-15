import { describe, expect, it, vi, afterEach } from 'vitest'
import {
  hasKnownStatus,
  isUpstreamBody,
  readUpstreamMessage,
  TRANSFORMS,
  unwrapEnvelope,
  type UpstreamBody,
} from '@/lib/proxy/envelope'
import type { EndpointId } from '@/lib/api/registry'

/**
 * Technitium answers most endpoints with `{status, server, response}` but a few
 * (`status`, `user/login`, `user/session/get`) are flat. Getting the unwrap wrong
 * blanks an entire page, so the function self-heals when the declared envelope and
 * the real body disagree. These tests pin both the happy path and every
 * self-healing branch, plus the false-positive trap: a flat body that *also*
 * carries `status`/`server` but has real sibling fields must NOT be read as
 * wrapped.
 */

const EP = 'zones/list' as EndpointId
const LOGIN = 'user/login' as EndpointId

afterEach(() => {
  vi.restoreAllMocks()
})

describe('unwrapEnvelope', () => {
  it('takes response for a declared wrapped body', () => {
    const body = { status: 'ok', server: 's', response: { a: 1 } }
    expect(unwrapEnvelope(body, 'wrapped', EP)).toEqual({ payload: { a: 1 }, healed: false })
  })

  it('self-heals a declared wrapped body that has no response key', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const body = { status: 'ok', server: 's', token: 'abc' }
    const result = unwrapEnvelope(body, 'wrapped', EP)
    expect(result).toEqual({ payload: { token: 'abc' }, healed: true })
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('strips status/server from a declared flat body', () => {
    const body = { status: 'ok', server: 's', token: 'abc', displayName: 'admin' }
    expect(unwrapEnvelope(body, 'flat', LOGIN)).toEqual({
      payload: { token: 'abc', displayName: 'admin' },
      healed: false,
    })
  })

  it('self-heals a declared flat body that is exactly the wrapped envelope', () => {
    const body = { status: 'ok', server: 's', response: { a: 1 } }
    expect(unwrapEnvelope(body, 'flat', LOGIN)).toEqual({ payload: { a: 1 }, healed: true })
  })

  it('does not mistake a real flat login body for a wrapped one', () => {
    // user/login's true shape carries status+server *and* sibling fields.
    const body = { status: 'ok', server: 's', token: 'abc', displayName: 'admin', info: { x: 1 } }
    const result = unwrapEnvelope(body, 'flat', LOGIN)
    expect(result.healed).toBe(false)
    expect(result.payload).toEqual({ token: 'abc', displayName: 'admin', info: { x: 1 } })
  })

  it.each([
    ['an array', [1, 2, 3]],
    ['a string', 'plain'],
    ['null', null],
  ])('returns %s body untouched', (_label, body) => {
    expect(unwrapEnvelope(body, 'wrapped', EP)).toEqual({ payload: body, healed: false })
  })

  it('keeps an explicit null response (write-op success) instead of healing', () => {
    const body = { status: 'ok', server: 's', response: null }
    expect(unwrapEnvelope(body, 'wrapped', EP)).toEqual({ payload: null, healed: false })
  })
})

describe('isUpstreamBody', () => {
  it('accepts only plain objects', () => {
    expect(isUpstreamBody({ status: 'ok' })).toBe(true)
    expect(isUpstreamBody([1])).toBe(false)
    expect(isUpstreamBody(null)).toBe(false)
    expect(isUpstreamBody('text')).toBe(false)
  })
})

describe('hasKnownStatus', () => {
  it.each(['ok', 'invalid-token', '2fa-required', 'error'])('recognises %s', (status) => {
    expect(hasKnownStatus({ status } as UpstreamBody)).toBe(true)
  })

  it.each(['ok ', 'OK', 'weird'])('rejects %s', (status) => {
    expect(hasKnownStatus({ status } as UpstreamBody)).toBe(false)
  })

  it('rejects a body with no status', () => {
    expect(hasKnownStatus({} as UpstreamBody)).toBe(false)
  })
})

describe('readUpstreamMessage', () => {
  it('prefers errorMessage', () => {
    expect(readUpstreamMessage({ errorMessage: 'boom', message: 'other' } as UpstreamBody)).toBe('boom')
  })

  it('falls back to a string message', () => {
    expect(readUpstreamMessage({ message: 'just a message' } as UpstreamBody)).toBe('just a message')
  })

  it('ignores a non-string message', () => {
    expect(readUpstreamMessage({ message: 42 } as UpstreamBody)).toBe('Upstream request failed.')
  })

  it('uses the fallback when nothing is present', () => {
    expect(readUpstreamMessage({} as UpstreamBody)).toBe('Upstream request failed.')
  })
})

describe('TRANSFORMS', () => {
  it('is empty: payload transforms belong to the typed SDK, not the proxy', () => {
    // Contract guard. The proxy must stay a transparent pipe; any per-endpoint
    // reshaping is unit-tested in the SDK layer against real fixtures. A non-empty
    // TRANSFORMS would mean hidden, untested mutation slipped into the proxy.
    expect(TRANSFORMS).toEqual({})
    expect(Object.keys(TRANSFORMS)).toHaveLength(0)
  })
})
