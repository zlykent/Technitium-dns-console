import { describe, expect, it } from 'vitest'
import { ENDPOINT_COUNT, ENDPOINTS, API_DOMAINS, isKnownEndpoint, getEndpoint } from '@/lib/api/registry'

describe('endpoint registry', () => {
  it('holds the endpoint count it advertises', () => {
    expect(Object.keys(ENDPOINTS)).toHaveLength(ENDPOINT_COUNT)
  })

  it('assigns every endpoint to a declared domain', () => {
    const known = new Set<string>(API_DOMAINS)
    for (const [path, def] of Object.entries(ENDPOINTS)) {
      expect(known.has(def.domain), `${path} -> unknown domain '${def.domain}'`).toBe(true)
    }
  })

  it('declares at least one method per endpoint and only GET/POST', () => {
    for (const [path, def] of Object.entries(ENDPOINTS)) {
      expect(def.methods.length, `${path} has no methods`).toBeGreaterThan(0)
      for (const method of def.methods) {
        expect(['GET', 'POST'], `${path} uses ${method}`).toContain(method)
      }
    }
  })

  it('never requires a token for the two public entry points', () => {
    expect(getEndpoint('status')?.auth).toBe('none')
    expect(getEndpoint('user/login')?.auth).toBe('none')
  })

  it('requires a token for every other endpoint', () => {
    const publicPaths = new Set(['status', 'user/login'])
    for (const [path, def] of Object.entries(ENDPOINTS)) {
      if (publicPaths.has(path)) continue
      expect(def.auth, `${path} must be authenticated`).toBe('token')
    }
  })

  it('marks only the three known flat endpoints as flat', () => {
    const flat = Object.entries(ENDPOINTS)
      .filter(([, def]) => def.envelope === 'flat')
      .map(([path]) => path)
      .sort()
    expect(flat).toEqual(['status', 'user/login', 'user/session/get'])
  })

  it('classifies endpoints by response kind', () => {
    for (const [path, def] of Object.entries(ENDPOINTS)) {
      expect(['json', 'file', 'upload'], `${path} -> ${def.kind}`).toContain(def.kind)
    }
  })

  it('rejects unknown paths and path traversal', () => {
    expect(isKnownEndpoint('status')).toBe(true)
    expect(isKnownEndpoint('zones/list')).toBe(true)
    expect(isKnownEndpoint('zones/list/../../etc/passwd')).toBe(false)
    expect(isKnownEndpoint('')).toBe(false)
    expect(isKnownEndpoint('STATUS')).toBe(false)
  })
})
