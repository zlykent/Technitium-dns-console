import { describe, expect, it } from 'vitest'
import {
  ACTIVE_STORAGE_KEY,
  DEFAULT_PROFILE_ID,
  SERVERS_STORAGE_KEY,
  emptyStore,
  isDefaultProfile,
  makeProfileId,
  normaliseServerUrl,
  parseStoredServers,
  readStoredServers,
  withDefaultProfile,
  writeStoredServers,
  type ServerProfile,
  type StoredServers,
} from '@/lib/servers/store'

/**
 * The saved-server list: everything between "the operator typed an address" and
 * "the next request goes to that server".
 *
 * Three failure modes here are invisible until they cost somebody an outage:
 *
 *  - a bad address that is *stored* instead of rejected. `ftp://router` used to
 *    parse as host `ftp` with path `//router`, so the form accepted it and the
 *    operator spent the evening debugging DNS instead of a typo. The rejection
 *    is asserted explicitly.
 *  - a corrupt `localStorage` payload that throws during render. Every entry
 *    point degrades to `emptyStore()`; a single unguarded `JSON.parse` would
 *    white-screen the console for anyone whose stored list predates a change.
 *  - a credential reaching `localStorage`. The module's whole reason for living
 *    in the browser is that the list is not secret; the token stays in an
 *    httpOnly cookie. The write path is asserted to carry `profiles` and
 *    `activeId` and nothing else, and the round-trip is asserted to strip
 *    anything else that was smuggled onto a profile object.
 *
 * `withDefaultProfile` is also pinned as a pure function: it is called during
 * render, so mutating its argument would corrupt the caller's state on every
 * re-render.
 */

interface FakeStorage extends Pick<Storage, 'getItem' | 'setItem'> {
  dump(): Record<string, string>
}

function fakeStorage(initial: Record<string, string> = {}): FakeStorage {
  const map = new Map<string, string>(Object.entries(initial))
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, String(value))
    },
    dump: () => Object.fromEntries(map),
  }
}

function profile(overrides: Partial<ServerProfile> = {}): ServerProfile {
  return { id: 's1', name: 'lab', url: 'http://10.0.0.5:5380', ...overrides }
}

describe('storage keys', () => {
  it('versions the key so a future shape change cannot be misread', () => {
    expect(SERVERS_STORAGE_KEY).toBe('tdns.servers.v1')
    expect(ACTIVE_STORAGE_KEY).toBe('tdns.active.v1')
    expect(SERVERS_STORAGE_KEY).not.toBe(ACTIVE_STORAGE_KEY)
  })

  it('names the synthetic env profile with a value no hash can produce', () => {
    expect(DEFAULT_PROFILE_ID).toBe('__env__')
    expect(DEFAULT_PROFILE_ID.startsWith('s')).toBe(false)
  })
})

describe('normaliseServerUrl', () => {
  it('accepts a bare host:port and adds the scheme', () => {
    expect(normaliseServerUrl('10.0.0.5:5380')).toBe('http://10.0.0.5:5380')
    expect(normaliseServerUrl('localhost:5380')).toBe('http://localhost:5380')
    expect(normaliseServerUrl('dns01.lan:5380')).toBe('http://dns01.lan:5380')
    expect(normaliseServerUrl('10.0.0.5')).toBe('http://10.0.0.5')
  })

  it('keeps an explicit http or https scheme', () => {
    expect(normaliseServerUrl('http://10.0.0.5:5380')).toBe('http://10.0.0.5:5380')
    expect(normaliseServerUrl('https://dns.example.com:8443')).toBe('https://dns.example.com:8443')
  })

  it('drops the path, the query and a trailing slash', () => {
    expect(normaliseServerUrl('http://10.0.0.5:5380/api/status')).toBe('http://10.0.0.5:5380')
    expect(normaliseServerUrl('http://10.0.0.5:5380/')).toBe('http://10.0.0.5:5380')
    expect(normaliseServerUrl('http://10.0.0.5:5380///')).toBe('http://10.0.0.5:5380')
    expect(normaliseServerUrl('10.0.0.5:5380/?x=1')).toBe('http://10.0.0.5:5380')
  })

  it('lower-cases the scheme and the host but keeps a non-default port', () => {
    expect(normaliseServerUrl('HTTP://DNS.Example.COM:8443')).toBe('http://dns.example.com:8443')
    expect(normaliseServerUrl('https://dns.example.com')).toBe('https://dns.example.com')
  })

  it('drops a port that is the scheme default', () => {
    expect(normaliseServerUrl('http://10.0.0.5:80')).toBe('http://10.0.0.5')
    expect(normaliseServerUrl('https://10.0.0.5:443')).toBe('https://10.0.0.5')
  })

  it('drops credentials embedded in the address', () => {
    // A URL with a password in it must not end up in localStorage or in a header.
    expect(normaliseServerUrl('http://admin:secret@10.0.0.5:5380')).toBe('http://10.0.0.5:5380')
    expect(normaliseServerUrl('admin:secret@10.0.0.5:5380')).toBe('http://10.0.0.5:5380')
  })

  it('handles an IPv6 literal', () => {
    expect(normaliseServerUrl('[::1]:5380')).toBe('http://[::1]:5380')
    expect(normaliseServerUrl('http://[2001:db8::1]:5380')).toBe('http://[2001:db8::1]:5380')
  })

  it('trims surrounding whitespace', () => {
    expect(normaliseServerUrl('  10.0.0.5:5380  ')).toBe('http://10.0.0.5:5380')
    expect(normaliseServerUrl('\thttps://dns.example.com\n')).toBe('https://dns.example.com')
  })

  it('rejects another protocol outright instead of reading it as a hostname', () => {
    // The regression this pins: `ftp://router` used to become host `ftp`.
    expect(normaliseServerUrl('ftp://router')).toBeNull()
    expect(normaliseServerUrl('ws://10.0.0.5:5380')).toBeNull()
    expect(normaliseServerUrl('wss://10.0.0.5:5380')).toBeNull()
    expect(normaliseServerUrl('file:///etc/passwd')).toBeNull()
    expect(normaliseServerUrl('FTP://ROUTER')).toBeNull()
  })

  it('rejects empty and whitespace-only input', () => {
    expect(normaliseServerUrl('')).toBeNull()
    expect(normaliseServerUrl('   ')).toBeNull()
    expect(normaliseServerUrl('\t\n')).toBeNull()
  })

  it('rejects garbage, a scheme with no host and an out-of-range port', () => {
    expect(normaliseServerUrl('not a url')).toBeNull()
    expect(normaliseServerUrl('http://')).toBeNull()
    expect(normaliseServerUrl('http:///')).toBeNull()
    expect(normaliseServerUrl('/')).toBeNull()
    expect(normaliseServerUrl('10.0.0.5:99999')).toBeNull()
    expect(normaliseServerUrl('http://exa mple.com')).toBeNull()
  })
})

describe('makeProfileId', () => {
  it('is deterministic for the same origin', () => {
    const first = makeProfileId('http://10.0.0.5:5380')
    expect(makeProfileId('http://10.0.0.5:5380')).toBe(first)
    expect(makeProfileId('http://10.0.0.5:5380')).toBe(first)
  })

  it('differs for different origins', () => {
    const ids = [
      'http://10.0.0.5:5380',
      'http://10.0.0.6:5380',
      'https://10.0.0.5:5380',
      'http://10.0.0.5:8443',
      'http://dns.example.com',
    ].map(makeProfileId)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('produces a readable base36 id with a fixed prefix', () => {
    for (const url of ['http://10.0.0.5:5380', 'https://dns.example.com', 'http://a']) {
      const id = makeProfileId(url)
      expect(id, url).toMatch(/^s[0-9a-z]+$/)
      expect(id.startsWith('s')).toBe(true)
    }
  })

  it('can never collide with the synthetic env profile id', () => {
    for (const url of ['', 'http://10.0.0.5:5380', '__env__', 's']) {
      expect(makeProfileId(url)).not.toBe(DEFAULT_PROFILE_ID)
    }
  })

  it('maps an empty address to a stable zero hash', () => {
    expect(makeProfileId('')).toBe('s0')
  })
})

describe('emptyStore', () => {
  it('is an empty list with no active server', () => {
    expect(emptyStore()).toEqual({ profiles: [], activeId: null })
  })

  it('returns a fresh object every call so a caller can mutate it', () => {
    const a = emptyStore()
    const b = emptyStore()
    expect(a).not.toBe(b)
    expect(a.profiles).not.toBe(b.profiles)
    a.profiles.push(profile())
    expect(b.profiles).toEqual([])
  })
})

describe('withDefaultProfile', () => {
  it('returns the saved profiles untouched when there is no env target', () => {
    const saved = [profile(), profile({ id: 's2', name: 'home', url: 'http://10.0.0.9:5380' })]
    for (const target of [null, undefined, '']) {
      const out = withDefaultProfile(saved, target)
      expect(out, String(target)).toEqual(saved)
      expect(out).not.toBe(saved)
    }
  })

  it('puts the env target first, under the synthetic id and labelled with its host', () => {
    const out = withDefaultProfile([profile()], '127.0.0.1:5380')
    expect(out).toHaveLength(2)
    expect(out[0]).toEqual({ id: DEFAULT_PROFILE_ID, name: '127.0.0.1:5380', url: 'http://127.0.0.1:5380' })
    expect(out[1]).toEqual(profile())
  })

  it('labels the env profile without a default port', () => {
    expect(withDefaultProfile([], 'https://dns.example.com')[0].name).toBe('dns.example.com')
    expect(withDefaultProfile([], 'http://dns.example.com:80')[0].name).toBe('dns.example.com')
  })

  it('normalises the env target before comparing, so a saved duplicate disappears', () => {
    const saved = [profile({ id: 'sx', name: 'same box', url: 'http://10.0.0.5:5380' })]
    const out = withDefaultProfile(saved, 'http://10.0.0.5:5380/api')
    expect(out).toHaveLength(1)
    expect(out[0].id).toBe(DEFAULT_PROFILE_ID)
    expect(out[0].name).toBe('10.0.0.5:5380')
  })

  it('does not deduplicate a saved profile whose url was never normalised', () => {
    // The guarantee comes from `parseStoredServers`, which normalises on the way
    // in; this function compares strings. Pinned so the split of responsibility
    // is explicit rather than assumed.
    const saved = [profile({ url: 'http://10.0.0.5:5380/' })]
    expect(withDefaultProfile(saved, 'http://10.0.0.5:5380')).toHaveLength(2)
  })

  it('removes duplicates within the saved list even without an env target', () => {
    const saved = [profile(), profile({ id: 's9', name: 'clone' }), profile({ id: 's2', url: 'http://10.0.0.9:5380' })]
    const out = withDefaultProfile(saved, null)
    expect(out).toHaveLength(2)
    expect(out.map((p) => p.id)).toEqual(['s1', 's2'])
    // The first name wins, so a rename in the UI is not undone by a stale clone.
    expect(out[0].name).toBe('lab')
  })

  it('ignores an env target it cannot normalise', () => {
    const saved = [profile()]
    expect(withDefaultProfile(saved, 'ftp://router')).toEqual(saved)
    expect(withDefaultProfile(saved, 'not a url')).toEqual(saved)
    expect(withDefaultProfile(saved, '   ')).toEqual(saved)
  })

  it('does not modify the array it was given', () => {
    const saved = [profile()]
    const snapshot = JSON.parse(JSON.stringify(saved)) as ServerProfile[]
    const out = withDefaultProfile(saved, 'http://10.0.0.9:5380')
    out.push(profile({ id: 's3' }))
    out[0].name = 'mutated'
    expect(saved).toEqual(snapshot)
    expect(saved).toHaveLength(1)
  })

  it('returns an empty list for no profiles and no target', () => {
    expect(withDefaultProfile([], null)).toEqual([])
    expect(withDefaultProfile([], undefined)).toEqual([])
  })
})

describe('parseStoredServers', () => {
  it('degrades to an empty store for absent and blank input', () => {
    expect(parseStoredServers(null)).toEqual(emptyStore())
    expect(parseStoredServers('')).toEqual(emptyStore())
  })

  it('degrades to an empty store for malformed JSON', () => {
    for (const raw of ['{', 'not json', '{"profiles": [}', 'undefined', '{profiles:[]}']) {
      expect(parseStoredServers(raw), raw).toEqual(emptyStore())
    }
  })

  it('degrades to an empty store when the top level is not an object', () => {
    for (const raw of ['42', '"a string"', 'true', 'null', '[]']) {
      expect(parseStoredServers(raw), raw).toEqual(emptyStore())
    }
  })

  it('degrades to an empty store when profiles is not an array', () => {
    for (const raw of ['{}', '{"profiles":null}', '{"profiles":{}}', '{"profiles":"x"}', '{"activeId":"s1"}']) {
      expect(parseStoredServers(raw), raw).toEqual(emptyStore())
    }
  })

  it('skips entries that are not objects or have no usable url', () => {
    const raw = JSON.stringify({
      profiles: [null, 42, 'x', [], {}, { name: 'no url' }, { url: 5380 }, { url: '' }, { url: 'ftp://router' }, { url: 'not a url' }],
    })
    expect(parseStoredServers(raw)).toEqual(emptyStore())
  })

  it('keeps the valid entries around the invalid ones', () => {
    const raw = JSON.stringify({
      profiles: [null, { url: 'ftp://router' }, { id: 's1', name: 'lab', url: '10.0.0.5:5380' }, { url: '' }],
    })
    expect(parseStoredServers(raw)).toEqual({
      profiles: [{ id: 's1', name: 'lab', url: 'http://10.0.0.5:5380' }],
      activeId: null,
    })
  })

  it('normalises the stored url on the way in', () => {
    const raw = JSON.stringify({ profiles: [{ url: 'HTTP://DNS.Example.COM:8443/api/status' }] })
    expect(parseStoredServers(raw).profiles[0].url).toBe('http://dns.example.com:8443')
  })

  it('de-duplicates entries that normalise to the same origin', () => {
    const raw = JSON.stringify({
      profiles: [
        { id: 's1', name: 'first', url: 'http://10.0.0.5:5380' },
        { id: 's2', name: 'second', url: '10.0.0.5:5380/' },
        { id: 's3', name: 'third', url: 'HTTP://10.0.0.5:5380/api' },
      ],
    })
    const parsed = parseStoredServers(raw)
    expect(parsed.profiles).toHaveLength(1)
    expect(parsed.profiles[0]).toEqual({ id: 's1', name: 'first', url: 'http://10.0.0.5:5380' })
  })

  it('generates an id when the stored one is missing, blank or not a string', () => {
    const url = 'http://10.0.0.5:5380'
    const expected = makeProfileId(url)
    for (const entry of [{ url }, { id: '', url }, { id: 42, url }, { id: null, url }]) {
      const parsed = parseStoredServers(JSON.stringify({ profiles: [entry] }))
      expect(parsed.profiles[0].id, JSON.stringify(entry)).toBe(expected)
    }
  })

  it('keeps a stored id so the active selection survives a reload', () => {
    const parsed = parseStoredServers(JSON.stringify({ profiles: [{ id: 'kept', name: 'lab', url: '10.0.0.5:5380' }] }))
    expect(parsed.profiles[0].id).toBe('kept')
  })

  it('falls back to the host for a missing or blank name', () => {
    const raw = JSON.stringify({
      profiles: [
        { id: 'a', url: 'http://10.0.0.5:5380' },
        { id: 'b', name: '   ', url: 'https://dns.example.com' },
        { id: 'c', name: 42, url: 'http://10.0.0.9:5380' },
        { id: 'd', name: null, url: 'http://10.0.0.10:5380' },
      ],
    })
    expect(parseStoredServers(raw).profiles.map((p) => p.name)).toEqual([
      '10.0.0.5:5380',
      'dns.example.com',
      '10.0.0.9:5380',
      '10.0.0.10:5380',
    ])
  })

  it('trims a stored name but keeps its case', () => {
    const raw = JSON.stringify({ profiles: [{ id: 'a', name: '  Head Office  ', url: '10.0.0.5:5380' }] })
    expect(parseStoredServers(raw).profiles[0].name).toBe('Head Office')
  })

  it('drops every key that is not id, name or url', () => {
    // The credential guard on the read path: a hand-edited or older payload
    // cannot smuggle a token into the profile the UI holds in memory.
    const raw = JSON.stringify({
      profiles: [{ id: 'a', name: 'lab', url: '10.0.0.5:5380', token: 'super-secret', password: 'hunter2' }],
      activeId: 'a',
      sessionCookie: 'tdns.token=abc',
    })
    const parsed = parseStoredServers(raw)
    expect(parsed.profiles[0]).toEqual({ id: 'a', name: 'lab', url: 'http://10.0.0.5:5380' })
    expect(Object.keys(parsed.profiles[0])).toEqual(['id', 'name', 'url'])
    expect(Object.keys(parsed)).toEqual(['profiles', 'activeId'])
    expect(JSON.stringify(parsed)).not.toContain('super-secret')
    expect(JSON.stringify(parsed)).not.toContain('hunter2')
    expect(JSON.stringify(parsed)).not.toContain('tdns.token')
  })

  it('keeps a string activeId and nulls anything else', () => {
    expect(parseStoredServers(JSON.stringify({ profiles: [], activeId: 's1' })).activeId).toBe('s1')
    for (const activeId of [42, null, true, {}, [], '']) {
      const raw = JSON.stringify({ profiles: [], activeId })
      const parsed = parseStoredServers(raw)
      // The empty string is a string, so it survives verbatim; the rest do not.
      expect(parsed.activeId, raw).toBe(typeof activeId === 'string' ? activeId : null)
    }
    expect(parseStoredServers(JSON.stringify({ profiles: [] })).activeId).toBeNull()
  })

  it('keeps an activeId that matches no profile rather than guessing', () => {
    const raw = JSON.stringify({ profiles: [{ id: 'a', name: 'lab', url: '10.0.0.5:5380' }], activeId: 'gone' })
    expect(parseStoredServers(raw).activeId).toBe('gone')
  })
})

describe('readStoredServers', () => {
  it('returns an empty store when there is no storage at all', () => {
    expect(readStoredServers(null)).toEqual(emptyStore())
    expect(readStoredServers(undefined)).toEqual(emptyStore())
  })

  it('returns an empty store when nothing has been saved yet', () => {
    expect(readStoredServers(fakeStorage())).toEqual(emptyStore())
    expect(readStoredServers(fakeStorage({ 'other.key': 'x' }))).toEqual(emptyStore())
  })

  it('reads exactly the versioned key', () => {
    const payload = JSON.stringify({ profiles: [{ id: 'a', name: 'lab', url: '10.0.0.5:5380' }], activeId: 'a' })
    const storage = fakeStorage({ [SERVERS_STORAGE_KEY]: payload, 'tdns.servers.v2': 'ignored' })
    expect(readStoredServers(storage)).toEqual({
      profiles: [{ id: 'a', name: 'lab', url: 'http://10.0.0.5:5380' }],
      activeId: 'a',
    })
  })

  it('swallows a storage access error instead of failing the render', () => {
    // Safari in private mode throws on `getItem` as well as on `setItem`.
    const storage: Pick<Storage, 'getItem'> = {
      getItem: () => {
        throw new DOMException('denied', 'SecurityError')
      },
    }
    expect(readStoredServers(storage)).toEqual(emptyStore())
  })

  it('degrades to an empty store when the stored payload is corrupt', () => {
    expect(readStoredServers(fakeStorage({ [SERVERS_STORAGE_KEY]: '{{{' }))).toEqual(emptyStore())
  })
})

describe('writeStoredServers', () => {
  it('does nothing and does not throw when there is no storage', () => {
    expect(() => writeStoredServers(null, emptyStore())).not.toThrow()
    expect(() => writeStoredServers(undefined, emptyStore())).not.toThrow()
  })

  it('writes the versioned key', () => {
    const storage = fakeStorage()
    writeStoredServers(storage, emptyStore())
    expect(Object.keys(storage.dump())).toEqual([SERVERS_STORAGE_KEY])
  })

  it('swallows a quota error so the tab keeps working', () => {
    const storage: Pick<Storage, 'setItem'> = {
      setItem: () => {
        throw new DOMException('quota exceeded', 'QuotaExceededError')
      },
    }
    expect(() => writeStoredServers(storage, emptyStore())).not.toThrow()
  })

  it('writes only profiles and activeId, whatever else is on the state object', () => {
    const storage = fakeStorage()
    const state = {
      profiles: [profile()],
      activeId: 's1',
      token: 'super-secret',
      cookie: 'tdns.token=abc',
    } as unknown as StoredServers
    writeStoredServers(storage, state)

    const raw = storage.dump()[SERVERS_STORAGE_KEY]
    expect(Object.keys(JSON.parse(raw) as Record<string, unknown>)).toEqual(['profiles', 'activeId'])
    expect(raw).not.toContain('super-secret')
    expect(raw).not.toContain('tdns.token')
    expect(JSON.parse(raw)).toEqual({ profiles: [profile()], activeId: 's1' })
  })

  it('serialises an empty store as a valid payload, not as undefined', () => {
    const storage = fakeStorage()
    writeStoredServers(storage, emptyStore())
    expect(storage.dump()[SERVERS_STORAGE_KEY]).toBe('{"profiles":[],"activeId":null}')
  })
})

describe('isDefaultProfile', () => {
  it('is true only for the synthetic env profile', () => {
    expect(isDefaultProfile({ id: DEFAULT_PROFILE_ID, name: 'env', url: 'http://10.0.0.5:5380' })).toBe(true)
  })

  it('is false for a saved profile, null and undefined', () => {
    expect(isDefaultProfile(profile())).toBe(false)
    expect(isDefaultProfile(profile({ id: '__env' }))).toBe(false)
    expect(isDefaultProfile(profile({ id: 'env' }))).toBe(false)
    expect(isDefaultProfile(null)).toBe(false)
    expect(isDefaultProfile(undefined)).toBe(false)
  })

  it('recognises the profile withDefaultProfile builds', () => {
    const [first] = withDefaultProfile([], 'http://10.0.0.5:5380')
    expect(isDefaultProfile(first)).toBe(true)
    expect(isDefaultProfile(withDefaultProfile([profile()], null)[0])).toBe(false)
  })
})

describe('persistence round-trip', () => {
  it('reads back exactly what it wrote', () => {
    const storage = fakeStorage()
    const state: StoredServers = {
      profiles: [
        { id: 's1', name: 'lab', url: 'http://10.0.0.5:5380' },
        { id: 's2', name: 'home', url: 'https://dns.example.com' },
      ],
      activeId: 's2',
    }
    writeStoredServers(storage, state)
    expect(readStoredServers(storage)).toEqual(state)
  })

  it('survives a second write over an existing payload', () => {
    const storage = fakeStorage()
    writeStoredServers(storage, { profiles: [profile()], activeId: 's1' })
    writeStoredServers(storage, { profiles: [], activeId: null })
    expect(readStoredServers(storage)).toEqual(emptyStore())
  })

  it('comes back through the default-profile merge with the env target first', () => {
    const storage = fakeStorage()
    writeStoredServers(storage, { profiles: [profile({ id: 's2', url: 'http://10.0.0.9:5380' })], activeId: 's2' })
    const read = readStoredServers(storage)
    const merged = withDefaultProfile(read.profiles, '10.0.0.5:5380')
    expect(merged.map((p) => p.url)).toEqual(['http://10.0.0.5:5380', 'http://10.0.0.9:5380'])
    expect(merged.map((p) => p.id)).toEqual([DEFAULT_PROFILE_ID, 's2'])
    // The stored activeId still addresses a profile that exists after the merge.
    expect(merged.some((p) => p.id === read.activeId)).toBe(true)
  })

  it('strips a credential smuggled onto a profile object on the way back in', () => {
    // `writeStoredServers` serialises profile objects as given; the guarantee
    // that no secret survives a reload comes from the read path rebuilding each
    // profile from three known keys. Both halves are asserted so the split is
    // documented rather than assumed.
    const storage = fakeStorage()
    const leaky = {
      profiles: [{ ...profile(), token: 'super-secret' } as unknown as ServerProfile],
      activeId: 's1',
    }
    writeStoredServers(storage, leaky)
    expect(storage.dump()[SERVERS_STORAGE_KEY]).toContain('super-secret')

    const read = readStoredServers(storage)
    expect(read.profiles[0]).toEqual(profile())
    expect(Object.keys(read.profiles[0])).toEqual(['id', 'name', 'url'])
    expect(JSON.stringify(read)).not.toContain('super-secret')
  })

  it('regenerates ids for a payload written by an older version', () => {
    const storage = fakeStorage({
      [SERVERS_STORAGE_KEY]: JSON.stringify({ profiles: [{ url: '10.0.0.5:5380' }, { url: '10.0.0.9:5380' }] }),
    })
    const read = readStoredServers(storage)
    expect(read.profiles.map((p) => p.id)).toEqual([
      makeProfileId('http://10.0.0.5:5380'),
      makeProfileId('http://10.0.0.9:5380'),
    ])
    writeStoredServers(storage, read)
    expect(readStoredServers(storage)).toEqual(read)
  })
})
