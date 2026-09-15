import { act, fireEvent, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CopyButton, DataValue, copyText } from '@/components/app/copy-button'
import { renderWithProviders } from './utils/render-with-providers'

/**
 * Copy-to-clipboard is copy-paste plumbing for an ops console: an operator reads
 * a DS digest here and pastes it into a registrar panel. The LAN console runs
 * over plain HTTP, which is *not* a secure context, so `navigator.clipboard` is
 * unavailable and the legacy `execCommand` fallback is the real code path — not
 * defensive decoration. These tests pin down:
 *
 *  - `copyText` prefers the async Clipboard API in a secure context,
 *  - falls back to `execCommand` when `writeText` rejects,
 *  - falls back to `execCommand` when the context is not secure (clipboard skipped),
 *  - returns `false` when both paths fail (so the caller can surface an error),
 *  - `CopyButton` swaps its accessible label to "已复制" on success and reverts
 *    after the 1500 ms timer (fake timers), and is disabled for an empty value,
 *  - `DataValue` renders the value text and only offers a copy affordance when
 *    `copy` is on and a value exists.
 */

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

function setSecureContext(value: boolean): void {
  Object.defineProperty(window, 'isSecureContext', { configurable: true, value })
}

const writeText = () => vi.mocked(navigator.clipboard.writeText)
const execCommand = () => vi.mocked(document.execCommand)

describe('copyText', () => {
  beforeEach(() => setSecureContext(true))

  it('uses the async Clipboard API in a secure context', async () => {
    writeText().mockResolvedValueOnce(undefined)
    await expect(copyText('ds-digest')).resolves.toBe(true)
    expect(writeText()).toHaveBeenCalledWith('ds-digest')
    expect(execCommand()).not.toHaveBeenCalled()
  })

  it('falls back to execCommand when writeText rejects', async () => {
    // A secure context can still deny the write (permissions policy, focus loss).
    writeText().mockRejectedValueOnce(new Error('NotAllowedError'))
    execCommand().mockReturnValueOnce(true)
    await expect(copyText('fallback-value')).resolves.toBe(true)
    expect(execCommand()).toHaveBeenCalledWith('copy')
  })

  it('skips the clipboard entirely when the context is not secure', async () => {
    // The plain-HTTP LAN path: navigator.clipboard is undefined there, so the
    // branch must go straight to execCommand without touching writeText.
    setSecureContext(false)
    execCommand().mockReturnValueOnce(true)
    await expect(copyText('http-value')).resolves.toBe(true)
    expect(writeText()).not.toHaveBeenCalled()
    expect(execCommand()).toHaveBeenCalledWith('copy')
  })

  it('returns false when both the clipboard and execCommand fail', async () => {
    writeText().mockRejectedValueOnce(new Error('denied'))
    execCommand().mockReturnValueOnce(false)
    await expect(copyText('doomed')).resolves.toBe(false)
  })
})

describe('CopyButton', () => {
  beforeEach(() => {
    setSecureContext(true)
    vi.useFakeTimers()
  })
  afterEach(() => vi.useRealTimers())

  it('shows a copied confirmation and reverts after the delay', async () => {
    writeText().mockResolvedValue(undefined)
    renderWithProviders(<CopyButton value="token-value" />)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '复制' }))
    })
    // Success feedback is exposed through the accessible name, not just colour.
    expect(screen.getByRole('button', { name: '已复制' })).toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(1500)
    })
    expect(screen.getByRole('button', { name: '复制' })).toBeInTheDocument()
  })

  it('is disabled when the value is empty', () => {
    renderWithProviders(<CopyButton value="" />)
    expect(screen.getByRole('button', { name: '复制' })).toBeDisabled()
  })
})

describe('DataValue', () => {
  beforeEach(() => setSecureContext(true))

  it('renders the value text with a copy button by default', () => {
    renderWithProviders(<DataValue value="ns1.example.com" />)
    expect(screen.getByText('ns1.example.com')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '复制' })).toBeInTheDocument()
  })

  it('omits the copy button when copy is disabled', () => {
    renderWithProviders(<DataValue value="ns1.example.com" copy={false} />)
    expect(screen.getByText('ns1.example.com')).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('renders an em dash and no copy button for a missing value', () => {
    renderWithProviders(<DataValue value={null} />)
    expect(screen.getByText('—')).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})
