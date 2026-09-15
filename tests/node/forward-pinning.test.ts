import { afterEach, describe, expect, it, vi } from 'vitest'
import { closeAllDispatchers, pinnedLookup } from '@/lib/proxy/forward'

/**
 * The DNS-rebinding defence.
 *
 * `resolveTarget` validates an address and `pinnedLookup` is what makes that
 * validation stick: undici asks the OS to resolve the hostname again when it
 * opens the socket, and without this hook a hostile name could answer with a
 * public IP the first time and `169.254.169.254` the second. The hook is
 * untestable through a mocked `fetch`, so it is exercised directly against both
 * shapes of Node's `dns.lookup` callback convention.
 */

afterEach(async () => {
  await closeAllDispatchers()
})

describe('pinnedLookup', () => {
  it('answers the single-address form with the pinned IPv4', () => {
    const callback = vi.fn()
    pinnedLookup('203.0.113.7', 4)('dns.example.com', { family: 4 }, callback)
    expect(callback).toHaveBeenCalledWith(null, '203.0.113.7', 4)
  })

  it('answers the all:true form with a one-element list', () => {
    const callback = vi.fn()
    pinnedLookup('203.0.113.7', 4)('dns.example.com', { all: true }, callback)
    expect(callback).toHaveBeenCalledWith(null, [{ address: '203.0.113.7', family: 4 }])
  })

  it('supports the no-options call shape', () => {
    // `dns.lookup(host, cb)` is legal, and undici has used it; mistaking the
    // callback for an options object would silently drop the pin.
    const callback = vi.fn()
    pinnedLookup('2001:db8::1', 6)('dns.example.com', callback, undefined)
    expect(callback).toHaveBeenCalledWith(null, '2001:db8::1', 6)
  })

  it('preserves the IPv6 family so the socket is not opened as IPv4', () => {
    const callback = vi.fn()
    pinnedLookup('2001:db8::1', 6)('dns.example.com', {}, callback)
    expect(callback).toHaveBeenCalledWith(null, '2001:db8::1', 6)
  })

  it('never reports an error and never returns an alternative address', () => {
    // Whatever the caller asks for, the answer is the vetted address. A second
    // candidate is exactly what a rebinding attack needs.
    const callback = vi.fn()
    const lookup = pinnedLookup('198.51.100.9', 4)
    lookup('evil.example.com', { all: true, family: 6, hints: 1 }, callback)

    expect(callback).toHaveBeenCalledTimes(1)
    const [err, list] = callback.mock.calls[0] as [null, { address: string; family: number }[]]
    expect(err).toBeNull()
    expect(list).toHaveLength(1)
    expect(list[0]).toEqual({ address: '198.51.100.9', family: 4 })
  })

  it('ignores the hostname it is asked about', () => {
    // The hostname is attacker-controlled; the address is not. Passing the
    // hostname through to the OS resolver would reintroduce the rebinding window.
    const callback = vi.fn()
    pinnedLookup('203.0.113.7', 4)('anything-at-all', {}, callback)
    expect(callback).toHaveBeenCalledWith(null, '203.0.113.7', 4)
  })
})
