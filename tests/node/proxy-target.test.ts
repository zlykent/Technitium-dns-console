import { describe, expect, it, vi, beforeEach } from 'vitest'
import { lookup } from 'node:dns/promises'
import { DnsApiError } from '@/lib/api/errors'
import {
  buildUpstreamUrl,
  isAddressBlocked,
  readProxyConfig,
  resolveTarget,
  unwrapMappedAddress,
  type ProxyConfig,
  type ProxyTarget,
} from '@/lib/proxy/target'

/**
 * `target.ts` is the SSRF guard for the whole proxy. The browser supplies the
 * upstream address (server switcher), so every value reaching this module is
 * hostile until proven otherwise. A single missed address class — cloud
 * metadata, loopback, an IPv4-mapped IPv6 smuggle — turns the proxy into an
 * open relay into the operator's network. These tests therefore enumerate the
 * blocked/allowed matrix densely rather than sampling it.
 *
 * `node:dns/promises#lookup` is stubbed so hostname resolution is deterministic
 * and no real network/DNS is touched.
 */
vi.mock('node:dns/promises', () => ({ lookup: vi.fn() }))

const mockedLookup = vi.mocked(lookup)

function config(overrides: Partial<ProxyConfig> = {}): ProxyConfig {
  return { defaultTarget: undefined, allowedTargets: [], allowLoopback: false, ...overrides }
}

beforeEach(() => {
  mockedLookup.mockReset()
})

describe('unwrapMappedAddress', () => {
  it('returns a pure IPv4 address unchanged with family 4', () => {
    expect(unwrapMappedAddress('169.254.169.254')).toEqual({ address: '169.254.169.254', family: 4 })
  })

  it('returns a pure IPv6 address with family 6', () => {
    expect(unwrapMappedAddress('2606:4700:4700::1111')).toEqual({ address: '2606:4700:4700::1111', family: 6 })
  })

  it('unwraps an IPv4-mapped IPv6 address to its IPv4 form', () => {
    expect(unwrapMappedAddress('::ffff:169.254.169.254')).toEqual({ address: '169.254.169.254', family: 4 })
  })

  it('unwraps a NAT64 well-known-prefix address to its IPv4 form', () => {
    // 64:ff9b::a9fe:a9fe -> a9fe:a9fe -> 169.254.169.254
    expect(unwrapMappedAddress('64:ff9b::a9fe:a9fe')).toEqual({ address: '169.254.169.254', family: 4 })
  })

  it('is case-insensitive for the mapped prefix', () => {
    expect(unwrapMappedAddress('::FFFF:127.0.0.1')).toEqual({ address: '127.0.0.1', family: 4 })
  })

  it('returns a non-IP string verbatim as family 6', () => {
    expect(unwrapMappedAddress('Example.COM')).toEqual({ address: 'Example.COM', family: 6 })
  })
})

describe('isAddressBlocked', () => {
  const alwaysBlocked = [
    '169.254.169.254', // cloud metadata (IPv4)
    'fd00:ec2::254', // cloud metadata (IPv6)
    '0.0.0.0',
    '0.1.2.3',
    '::',
    '224.0.0.1', // multicast
    '240.0.0.1', // reserved
    '255.255.255.255', // broadcast
    'ff02::1', // multicast v6
    'fec0::1', // deprecated site-local v6
  ]

  it.each(alwaysBlocked)('blocks %s regardless of trust', (address) => {
    expect(isAddressBlocked(address, false)).toBe(true)
    expect(isAddressBlocked(address, true)).toBe(true)
  })

  const untrustedOnly = ['127.0.0.1', '127.9.9.9', '::1', '169.254.1.1', 'fe80::1']

  it.each(untrustedOnly)('blocks %s when the target is untrusted (request header)', (address) => {
    expect(isAddressBlocked(address, false)).toBe(true)
  })

  it.each(['127.0.0.1', '::1'])('allows loopback %s when the target is trusted (env config)', (address) => {
    expect(isAddressBlocked(address, true)).toBe(false)
  })

  // Loopback is covered above: trusted-only, never in "both allowed".
  const bothAllowed = ['10.0.0.1', '172.16.0.1', 'fd12:3456::1', '8.8.8.8', '2606:4700:4700::1111']

  it.each(bothAllowed)('allows private/public address %s under either trust level', (address) => {
    expect(isAddressBlocked(address, false)).toBe(false)
    expect(isAddressBlocked(address, true)).toBe(false)
  })

  it('blocks an IPv4-mapped loopback smuggle when untrusted', () => {
    expect(isAddressBlocked('::ffff:127.0.0.1', false)).toBe(true)
  })
})

describe('readProxyConfig', () => {
  it('reads from the supplied env object without touching process.env', () => {
    const cfg = readProxyConfig({
      TECHNITIUM_API_URL: 'http://10.0.0.5:5380',
      TECHNITIUM_ALLOWED_TARGETS: 'A.example.com:5380, ,b.example.com',
      PROXY_ALLOW_LOOPBACK: 'true',
    } as unknown as NodeJS.ProcessEnv)
    expect(cfg).toEqual({
      defaultTarget: 'http://10.0.0.5:5380',
      allowedTargets: ['a.example.com:5380', 'b.example.com'],
      allowLoopback: true,
    })
  })

  it('treats a blank TECHNITIUM_API_URL as undefined', () => {
    const cfg = readProxyConfig({ TECHNITIUM_API_URL: '   ' } as unknown as NodeJS.ProcessEnv)
    expect(cfg.defaultTarget).toBeUndefined()
  })

  it('only enables loopback when PROXY_ALLOW_LOOPBACK is exactly "true"', () => {
    expect(readProxyConfig({ PROXY_ALLOW_LOOPBACK: 'true' } as unknown as NodeJS.ProcessEnv).allowLoopback).toBe(true)
    expect(readProxyConfig({ PROXY_ALLOW_LOOPBACK: 'TRUE' } as unknown as NodeJS.ProcessEnv).allowLoopback).toBe(false)
    expect(readProxyConfig({ PROXY_ALLOW_LOOPBACK: '1' } as unknown as NodeJS.ProcessEnv).allowLoopback).toBe(false)
    expect(readProxyConfig({} as NodeJS.ProcessEnv).allowLoopback).toBe(false)
  })

  it('defaults to an empty allowlist when the variable is absent', () => {
    expect(readProxyConfig({} as NodeJS.ProcessEnv).allowedTargets).toEqual([])
  })
})

describe('resolveTarget', () => {
  it('throws no_target when neither a requested target nor a default exists', async () => {
    await expect(resolveTarget(null, config())).rejects.toMatchObject({ name: 'DnsApiError', code: 'no_target' })
  })

  it('falls back to the env default when the requested target is an empty string', async () => {
    const target = await resolveTarget('', config({ defaultTarget: 'http://127.0.0.1:5380' }))
    expect(target.fromEnv).toBe(true)
    expect(target.baseUrl).toBe('http://127.0.0.1:5380')
  })

  it('throws no_target for a malformed address', async () => {
    await expect(resolveTarget('http://', config())).rejects.toMatchObject({ code: 'no_target' })
    await expect(resolveTarget('http://exa mple.com', config())).rejects.toMatchObject({ code: 'no_target' })
  })

  it('rejects an explicit non-http scheme instead of parsing it as a hostname', async () => {
    // `ftp://x` used to be prefixed into `http://ftp://x`, i.e. host `ftp`. The
    // address still went through the block list, so it was never a bypass, but
    // the operator got "could not resolve 'ftp'" for what is really a typo.
    await expect(resolveTarget('ftp://router', config())).rejects.toMatchObject({ code: 'no_target' })
    await expect(resolveTarget('file:///etc/passwd', config())).rejects.toMatchObject({ code: 'no_target' })
    await expect(resolveTarget('gopher://x:5380', config())).rejects.toMatchObject({ code: 'no_target' })
    expect(mockedLookup).not.toHaveBeenCalled()
  })

  it('still accepts a bare host:port, which must not be read as a scheme', async () => {
    // The scheme test needs `://`; without that guard `localhost:5380` would be
    // rejected as protocol "localhost" and the common case would break.
    mockedLookup.mockResolvedValue([{ address: '127.0.0.1', family: 4 }] as unknown as Awaited<ReturnType<typeof lookup>>)
    const target = await resolveTarget('localhost:5380', { ...config(), allowLoopback: true })
    expect(target.baseUrl).toBe('http://localhost:5380')
    expect(target.fromEnv).toBe(false)
    expect(target.pinnedAddress).toBe('127.0.0.1')
  })

  it('resolves an IP-literal target and pins the address', async () => {
    const target = await resolveTarget('http://1.2.3.4:5380', config())
    expect(target).toEqual<ProxyTarget>({
      baseUrl: 'http://1.2.3.4:5380',
      origin: 'http://1.2.3.4:5380',
      hostname: '1.2.3.4',
      pinnedAddress: '1.2.3.4',
      family: 4,
      fromEnv: false,
    })
    expect(mockedLookup).not.toHaveBeenCalled()
  })

  it('strips a trailing slash from the base url', async () => {
    const target = await resolveTarget('http://1.2.3.4:5380/', config())
    expect(target.baseUrl).toBe('http://1.2.3.4:5380')
    expect(target.baseUrl.endsWith('/')).toBe(false)
  })

  it('rejects an IP-literal cloud-metadata target', async () => {
    await expect(resolveTarget('http://169.254.169.254/', config())).rejects.toMatchObject({ code: 'blocked_target' })
  })

  it('validates every address a hostname resolves to', async () => {
    mockedLookup.mockResolvedValue([
      { address: '8.8.8.8', family: 4 },
      { address: '169.254.169.254', family: 4 },
    ] as unknown as Awaited<ReturnType<typeof lookup>>)
    await expect(resolveTarget('http://dual.example.com', config())).rejects.toMatchObject({ code: 'blocked_target' })
  })

  it('pins the first safe address when all resolved addresses are allowed', async () => {
    mockedLookup.mockResolvedValue([
      { address: '8.8.8.8', family: 4 },
      { address: '1.1.1.1', family: 4 },
    ] as unknown as Awaited<ReturnType<typeof lookup>>)
    const target = await resolveTarget('http://ok.example.com', config())
    expect(target.pinnedAddress).toBe('8.8.8.8')
    expect(target.family).toBe(4)
  })

  it('throws upstream_unreachable when DNS lookup rejects', async () => {
    mockedLookup.mockRejectedValue(new Error('ENOTFOUND nope.example.com'))
    await expect(resolveTarget('http://nope.example.com', config())).rejects.toMatchObject({ code: 'upstream_unreachable' })
  })

  it('throws upstream_unreachable when DNS returns no records', async () => {
    mockedLookup.mockResolvedValue([] as unknown as Awaited<ReturnType<typeof lookup>>)
    await expect(resolveTarget('http://empty.example.com', config())).rejects.toMatchObject({ code: 'upstream_unreachable' })
  })

  it('allows a host:port listed in allowedTargets', async () => {
    const target = await resolveTarget('http://1.2.3.4:5380', config({ allowedTargets: ['1.2.3.4:5380'] }))
    expect(target.baseUrl).toBe('http://1.2.3.4:5380')
  })

  it('allows a bare host listed in allowedTargets', async () => {
    const target = await resolveTarget('http://1.2.3.4:5380', config({ allowedTargets: ['1.2.3.4'] }))
    expect(target.hostname).toBe('1.2.3.4')
  })

  it('rejects a target absent from a non-empty allowedTargets list', async () => {
    await expect(resolveTarget('http://9.9.9.9:5380', config({ allowedTargets: ['1.2.3.4:5380'] }))).rejects.toMatchObject({
      code: 'blocked_target',
    })
  })

  it('infers port 80 for http when matching the allowlist', async () => {
    const target = await resolveTarget('http://1.2.3.4', config({ allowedTargets: ['1.2.3.4:80'] }))
    expect(target.baseUrl).toBe('http://1.2.3.4')
  })

  it('infers port 443 for https when matching the allowlist', async () => {
    const target = await resolveTarget('https://1.2.3.4', config({ allowedTargets: ['1.2.3.4:443'] }))
    expect(target.baseUrl).toBe('https://1.2.3.4')
  })

  it('permits loopback for an env-sourced (trusted) default target', async () => {
    const target = await resolveTarget(null, config({ defaultTarget: 'http://127.0.0.1:5380' }))
    expect(target.fromEnv).toBe(true)
    expect(target.pinnedAddress).toBe('127.0.0.1')
  })

  it('rejects loopback for an untrusted request target unless allowLoopback', async () => {
    await expect(resolveTarget('http://127.0.0.1:5380', config())).rejects.toMatchObject({ code: 'blocked_target' })
    const allowed = await resolveTarget('http://127.0.0.1:5380', config({ allowLoopback: true }))
    expect(allowed.pinnedAddress).toBe('127.0.0.1')
  })
})

describe('buildUpstreamUrl', () => {
  const target: ProxyTarget = {
    baseUrl: 'http://1.2.3.4:5380',
    origin: 'http://1.2.3.4:5380',
    hostname: '1.2.3.4',
    pinnedAddress: '1.2.3.4',
    family: 4,
    fromEnv: false,
  }

  it('joins the base url with /api/ and the endpoint path', () => {
    const url = buildUpstreamUrl(target, 'zones/list', '')
    expect(url.toString()).toBe('http://1.2.3.4:5380/api/zones/list')
  })

  it('accepts a search string with or without a leading ?', () => {
    expect(buildUpstreamUrl(target, 'zones/list', '?x=1').search).toBe('?x=1')
    expect(buildUpstreamUrl(target, 'zones/list', 'x=1').search).toBe('?x=1')
  })

  it('appends rather than overwrites repeated parameters', () => {
    const url = buildUpstreamUrl(target, 'zones/list', '?x=1&x=2')
    expect(url.searchParams.getAll('x')).toEqual(['1', '2'])
  })

  it('omits the query separator when search is empty', () => {
    const url = buildUpstreamUrl(target, 'status', '')
    expect(url.search).toBe('')
    expect(url.toString()).not.toContain('?')
  })
})

describe('DnsApiError mapping', () => {
  it('uses the documented HTTP status for blocked_target and no_target', () => {
    expect(new DnsApiError('blocked_target', 'x').httpStatus).toBe(403)
    expect(new DnsApiError('no_target', 'x').httpStatus).toBe(400)
    expect(new DnsApiError('upstream_unreachable', 'x').httpStatus).toBe(502)
  })
})
