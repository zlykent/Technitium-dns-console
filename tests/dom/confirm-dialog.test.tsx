import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ConfirmDialog, useConfirmAction } from '@/components/app/confirm-dialog'
import { renderWithProviders } from './utils/render-with-providers'

/**
 * Every destructive operation in the console (delete zone, flush cache, revoke
 * session, uninstall app, restore backup) is gated by this dialog, so its guard
 * rails are safety-critical rather than cosmetic:
 *
 *  - `requireText` must keep the confirm button disarmed until the operator types
 *    the resource name *exactly* (case-sensitive, whitespace-trimmed). A dialog
 *    that arms on a partial or differently-cased match defeats the whole point of
 *    typing-to-confirm on a bulk delete.
 *  - while an async `onConfirm` is in flight the button must be disabled, so a
 *    double-click cannot fire two deletes.
 *  - when `onConfirm` rejects, the error is surfaced inline and the dialog stays
 *    open; a failed delete must never look like a success that silently closed.
 *  - Escape asks to close, but overlay-click does not (Radix `AlertDialog` blocks
 *    pointer-outside dismissal on purpose), and neither may close while busy.
 *  - `useConfirmAction` is the open/pending/error state machine the pages bind a
 *    mutation to, so its transitions are asserted directly.
 */

describe('ConfirmDialog', () => {
  it('renders nothing when closed', () => {
    renderWithProviders(<ConfirmDialog open={false} onOpenChange={() => {}} title="删除区域" />)
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('renders the title, description and default confirm label when open', () => {
    renderWithProviders(
      <ConfirmDialog open onOpenChange={() => {}} title="删除区域" description="此操作无法撤销。" />,
    )
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    expect(screen.getByText('删除区域')).toBeInTheDocument()
    expect(screen.getByText('此操作无法撤销。')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '确认' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '取消' })).toBeInTheDocument()
  })

  it('uses a custom confirm label when provided', () => {
    renderWithProviders(<ConfirmDialog open onOpenChange={() => {}} title="t" confirmLabel="永久删除" />)
    expect(screen.getByRole('button', { name: '永久删除' })).toBeInTheDocument()
  })

  describe('requireText', () => {
    it('keeps confirm disabled until the exact text is typed, then arms it', async () => {
      const user = userEvent.setup()
      renderWithProviders(<ConfirmDialog open onOpenChange={() => {}} title="删除区域" requireText="DELETE" />)
      const confirm = screen.getByRole('button', { name: '确认' })
      const field = screen.getByLabelText('请输入 DELETE 以确认')

      expect(confirm).toBeDisabled()

      // Wrong case must NOT arm — the match is exact.
      await user.type(field, 'delete')
      expect(confirm).toBeDisabled()

      await user.clear(field)
      await user.type(field, 'DELETE')
      expect(confirm).not.toBeDisabled()
    })

    it('tolerates surrounding whitespace but not a partial match', async () => {
      const user = userEvent.setup()
      renderWithProviders(<ConfirmDialog open onOpenChange={() => {}} title="t" requireText="example.com" />)
      const confirm = screen.getByRole('button', { name: '确认' })
      const field = screen.getByLabelText('请输入 example.com 以确认')

      await user.type(field, 'example.co')
      expect(confirm).toBeDisabled()

      await user.type(field, 'm  ')
      // Both sides are trimmed, so trailing spaces still arm the button.
      expect(confirm).not.toBeDisabled()
    })
  })

  it('disables the confirm button while an async onConfirm is pending', async () => {
    const user = userEvent.setup()
    let release: () => void = () => {}
    const onConfirm = vi.fn(() => new Promise<void>((resolve) => (release = resolve)))
    renderWithProviders(<ConfirmDialog open onOpenChange={() => {}} title="t" onConfirm={onConfirm} />)

    const confirm = screen.getByRole('button', { name: '确认' })
    await user.click(confirm)

    await waitFor(() => expect(confirm).toBeDisabled())
    expect(onConfirm).toHaveBeenCalledTimes(1)

    release()
    await waitFor(() => expect(confirm).not.toBeDisabled())
  })

  it('surfaces a rejected onConfirm inline and keeps the dialog open', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn().mockRejectedValue(new Error('delete failed'))
    renderWithProviders(<ConfirmDialog open onOpenChange={() => {}} title="删除区域" onConfirm={onConfirm} />)

    await user.click(screen.getByRole('button', { name: '确认' }))

    // The error is rendered as a compact ErrorState; the dialog must not close.
    await waitFor(() => expect(screen.getByText('delete failed')).toBeInTheDocument())
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
  })

  it('calls onConfirm once when armed and confirmed', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    renderWithProviders(<ConfirmDialog open onOpenChange={() => {}} title="t" onConfirm={onConfirm} />)
    await user.click(screen.getByRole('button', { name: '确认' }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('styles the confirm button destructively by default', () => {
    renderWithProviders(<ConfirmDialog open onOpenChange={() => {}} title="t" />)
    const confirm = screen.getByRole('button', { name: '确认' })
    expect(confirm.className).toContain('bg-destructive')
  })

  it('uses the primary style when tone is default', () => {
    renderWithProviders(<ConfirmDialog open onOpenChange={() => {}} title="t" tone="default" />)
    const confirm = screen.getByRole('button', { name: '确认' })
    expect(confirm.className).toContain('bg-primary')
    expect(confirm.className).not.toContain('bg-destructive')
  })

  it('closes on Escape via onOpenChange(false)', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    renderWithProviders(<ConfirmDialog open onOpenChange={onOpenChange} title="t" />)
    await user.keyboard('{Escape}')
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('does not close on overlay click (AlertDialog blocks pointer-outside dismissal)', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    const { container } = renderWithProviders(<ConfirmDialog open onOpenChange={onOpenChange} title="t" />)
    const overlay = document.querySelector('[data-slot="alert-dialog-overlay"]') ?? container
    await user.click(overlay as HTMLElement)
    expect(onOpenChange).not.toHaveBeenCalled()
  })

  it('suppresses Escape-to-close while the mutation is pending', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    renderWithProviders(<ConfirmDialog open onOpenChange={onOpenChange} title="t" pending />)
    await user.keyboard('{Escape}')
    // `!busy && onOpenChange(next)` — a pending delete must not be dismissible.
    expect(onOpenChange).not.toHaveBeenCalled()
  })
})

function ConfirmHarness({ run }: { run: () => Promise<void> }) {
  const { open, setOpen, pending, error, confirm } = useConfirmAction(run)
  return (
    <div>
      <span data-testid="open">{String(open)}</span>
      <span data-testid="pending">{String(pending)}</span>
      <span data-testid="error">{error instanceof Error ? error.message : 'none'}</span>
      <button type="button" onClick={() => setOpen(true)}>
        open
      </button>
      <button type="button" onClick={() => void confirm()}>
        confirm
      </button>
    </div>
  )
}

describe('useConfirmAction', () => {
  it('opens, tracks pending, then closes on success', async () => {
    const user = userEvent.setup()
    let release: () => void = () => {}
    const run = vi.fn(() => new Promise<void>((resolve) => (release = resolve)))
    renderWithProviders(<ConfirmHarness run={run} />)

    expect(screen.getByTestId('open')).toHaveTextContent('false')
    await user.click(screen.getByRole('button', { name: 'open' }))
    expect(screen.getByTestId('open')).toHaveTextContent('true')

    await user.click(screen.getByRole('button', { name: 'confirm' }))
    await waitFor(() => expect(screen.getByTestId('pending')).toHaveTextContent('true'))

    release()
    await waitFor(() => expect(screen.getByTestId('pending')).toHaveTextContent('false'))
    expect(screen.getByTestId('open')).toHaveTextContent('false')
    expect(screen.getByTestId('error')).toHaveTextContent('none')
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('records the error and stays open on failure', async () => {
    const user = userEvent.setup()
    const run = vi.fn().mockRejectedValue(new Error('upstream said no'))
    renderWithProviders(<ConfirmHarness run={run} />)

    await user.click(screen.getByRole('button', { name: 'open' }))
    await user.click(screen.getByRole('button', { name: 'confirm' }))

    await waitFor(() => expect(screen.getByTestId('error')).toHaveTextContent('upstream said no'))
    expect(screen.getByTestId('pending')).toHaveTextContent('false')
    expect(screen.getByTestId('open')).toHaveTextContent('true')
  })
})
