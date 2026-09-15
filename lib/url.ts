/**
 * Server-address parsing, shared by the proxy guard, the profile store and the
 * browser API client.
 *
 * All three carried their own copy of "prefix `http://` unless it already looks
 * like a URL", and all three had the same hole: an explicit non-http scheme was
 * treated as a bare hostname, so `ftp://router` parsed as host `ftp` with path
 * `//router`. That was not a bypass — the address still ran through the SSRF
 * block list and DNS pinning — but it turned "unsupported protocol" into "could
 * not resolve 'ftp'", which sends an operator off debugging their DNS instead of
 * fixing a typo. The protocol check that followed was unreachable for anything
 * coming out of that prefixing, so it only ever protected the env value.
 *
 * Kept free of Node and React imports: the client bundle, the server proxy and
 * the unit tests all load it.
 */

/**
 * `://` is required for something to count as a scheme. Without that, the very
 * common `localhost:5380` and `dns01.lan:5380` would be read as scheme
 * `localhost` / `dns01.lan` and rejected.
 */
const EXPLICIT_SCHEME = /^([a-z][a-z0-9+.-]*):\/\//i

export type ServerUrlFailure =
  | { reason: 'empty' }
  | { reason: 'protocol'; scheme: string }
  | { reason: 'invalid' }
  | { reason: 'host' }

export type ParsedServerUrl = { ok: true; url: URL; origin: string } | ({ ok: false } & ServerUrlFailure)

export function parseServerUrl(raw: string | null | undefined): ParsedServerUrl {
  const value = (raw ?? '').trim()
  if (!value) return { ok: false, reason: 'empty' }

  const scheme = EXPLICIT_SCHEME.exec(value)?.[1]?.toLowerCase()
  if (scheme && scheme !== 'http' && scheme !== 'https') {
    return { ok: false, reason: 'protocol', scheme }
  }

  let url: URL
  try {
    url = new URL(scheme ? value : `http://${value}`)
  } catch {
    return { ok: false, reason: 'invalid' }
  }

  // Belt and braces: with the scheme guard above this cannot fire for
  // request input, but the env value reaches here through the same door and a
  // future caller might not.
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, reason: 'protocol', scheme: url.protocol.replace(/:$/, '') }
  }
  if (!url.hostname) return { ok: false, reason: 'host' }

  return { ok: true, url, origin: url.origin }
}

/** The `host:port` form an allowlist entry is written in, with defaults filled. */
export function hostPortOf(url: URL): string {
  return `${url.hostname.toLowerCase()}:${url.port || (url.protocol === 'https:' ? '443' : '80')}`
}
