import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, beforeAll, vi } from 'vitest'

/**
 * jsdom supplies the DOM but none of the browser APIs the component library
 * leans on. Every stub below covers a real gap, not a convenience: without it
 * the corresponding component throws during render and the test reports a
 * failure that has nothing to do with the code under test.
 */

beforeAll(() => {
  // `next-themes` and several Radix primitives branch on media queries.
  if (!window.matchMedia) {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    })
  }

  // Radix Popover/Select/Tooltip and recharts all measure through these.
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  class IntersectionObserverStub {
    root = null
    rootMargin = ''
    thresholds: number[] = []
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return []
    }
  }
  vi.stubGlobal('ResizeObserver', ResizeObserverStub)
  vi.stubGlobal('IntersectionObserver', IntersectionObserverStub)

  // Radix scrolls the selected item into view; jsdom has no layout engine.
  window.HTMLElement.prototype.scrollIntoView = vi.fn()
  window.HTMLElement.prototype.scrollTo = vi.fn()

  // Blob downloads: token export, log export, config backup.
  window.URL.createObjectURL = vi.fn(() => 'blob:mock') as unknown as typeof window.URL.createObjectURL
  window.URL.revokeObjectURL = vi.fn() as unknown as typeof window.URL.revokeObjectURL

  // `copy-button.tsx` prefers the async Clipboard API and falls back to
  // `execCommand`. The LAN console runs over plain HTTP, where the async API is
  // unavailable, so both paths have to exist here for the fallback to be
  // testable at all.
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: vi.fn().mockResolvedValue(undefined), readText: vi.fn().mockResolvedValue('') },
  })
  document.execCommand = vi.fn().mockReturnValue(true) as unknown as typeof document.execCommand

  // jsdom implements no layout, so every element reports 0x0. Components that
  // guard against a zero width would take their "too narrow" branch in every
  // test and quietly stop covering the interesting path.
  Object.defineProperty(window.HTMLElement.prototype, 'offsetWidth', { configurable: true, get: () => 1024 })
  Object.defineProperty(window.HTMLElement.prototype, 'offsetHeight', { configurable: true, get: () => 768 })
})

// Radix portals and dialogs leave markup on `document.body` between tests; an
// uncleaned overlay swallows the next case's clicks and the failure reads as a
// flake.
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})
