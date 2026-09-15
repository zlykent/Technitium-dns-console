import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { EmptyState, ErrorState, LoadingState, NoResultsState } from '@/components/app/states'
import { DnsApiError } from '@/lib/api/errors'
import { renderWithProviders } from './utils/render-with-providers'

/**
 * The four non-happy states are the shared vocabulary every data surface in the
 * console speaks, so the regressions worth guarding are the ones that would
 * silently make eleven pages wrong at once:
 *
 *  - `ErrorState` derives its copy from `DnsApiError.code` through the `errors`
 *    namespace. If the code→key mapping breaks, an operator sees a raw upstream
 *    string (or a missing-key throw) instead of "无法连接到 DNS 服务器". A plain
 *    `Error` must fall back to the `unknown` bucket rather than crash.
 *  - the retry button is conditional: rendering it without an `onRetry` handler
 *    gives a dead control, so its presence must track the prop exactly.
 *  - the upstream message / inner message / stack trace live behind a collapsible
 *    because they are English-only and noisy. The test asserts they are reachable
 *    (mounted but hidden, then visible on expand) — a `hidden` that never lifts
 *    would hide the only actionable detail an operator has.
 *  - `EmptyState` must honour a caller-supplied icon and action instead of always
 *    painting the default inbox, otherwise pages cannot differentiate "no zones"
 *    from "no leases".
 */

function CustomIcon({ className }: { className?: string }) {
  return <span role="img" aria-label="custom-state-icon" className={className} />
}

describe('EmptyState', () => {
  it('renders a caller-supplied icon instead of the default inbox', () => {
    renderWithProviders(<EmptyState title="没有区域" icon={CustomIcon} />)
    expect(screen.getByRole('img', { name: 'custom-state-icon' })).toBeInTheDocument()
  })

  it('renders the action node so a primary call-to-action can live in the empty state', () => {
    renderWithProviders(<EmptyState title="没有区域" action={<button type="button">创建区域</button>} />)
    expect(screen.getByRole('button', { name: '创建区域' })).toBeInTheDocument()
  })

  it('renders the title and body text', () => {
    renderWithProviders(<EmptyState title="没有区域" body="先创建一个区域吧。" />)
    expect(screen.getByText('没有区域')).toBeInTheDocument()
    expect(screen.getByText('先创建一个区域吧。')).toBeInTheDocument()
  })
})

describe('NoResultsState', () => {
  it('falls back to the shared "no matches" copy when no title is given', () => {
    // This is the branch a filtered table hits; the default must come from
    // common:table.noResults so the wording matches every other list.
    renderWithProviders(<NoResultsState />)
    expect(screen.getByText('没有匹配的结果')).toBeInTheDocument()
  })

  it('accepts a custom title', () => {
    renderWithProviders(<NoResultsState title="没有匹配的记录" />)
    expect(screen.getByText('没有匹配的记录')).toBeInTheDocument()
  })
})

describe('LoadingState', () => {
  it('exposes a polite live region and renders the requested number of skeleton rows', () => {
    const { container } = renderWithProviders(<LoadingState rows={3} />)
    // role=status + sr-only label is how a screen reader learns the region is busy.
    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(screen.getByText('加载中…')).toBeInTheDocument()
    expect(container.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(3)
  })
})

describe('ErrorState', () => {
  it('maps a DnsApiError code to the errors namespace title and message', () => {
    renderWithProviders(<ErrorState error={new DnsApiError('upstream_unreachable', 'connect ECONNREFUSED')} />)
    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(screen.getByText('无法连接到 DNS 服务器')).toBeInTheDocument()
    expect(screen.getByText('目标主机无响应或域名解析失败。')).toBeInTheDocument()
    // The verbatim upstream text is shown too — it is the only actionable detail.
    expect(screen.getByText('connect ECONNREFUSED')).toBeInTheDocument()
  })

  it('falls back to the unknown bucket for a non-DnsApiError', () => {
    // A thrown Error from anywhere in the render/query path must not surface a
    // missing-key error; it should degrade to the generic copy.
    renderWithProviders(<ErrorState error={new Error('boom')} />)
    expect(screen.getByText('发生未知错误')).toBeInTheDocument()
    expect(screen.getByText('请求失败，且没有返回更多细节。')).toBeInTheDocument()
  })

  it('omits the retry button when onRetry is not provided', () => {
    // A retry button with no handler is a dead control; it must not render.
    renderWithProviders(<ErrorState error={new Error('boom')} />)
    expect(screen.queryByRole('button', { name: '重试' })).not.toBeInTheDocument()
  })

  it('renders the retry button when onRetry is provided', () => {
    renderWithProviders(<ErrorState error={new Error('boom')} onRetry={vi.fn()} />)
    expect(screen.getByRole('button', { name: '重试' })).toBeInTheDocument()
  })

  it('invokes onRetry when the retry button is clicked', async () => {
    const user = userEvent.setup()
    const onRetry = vi.fn()
    renderWithProviders(<ErrorState error={new Error('boom')} onRetry={onRetry} />)
    await user.click(screen.getByRole('button', { name: '重试' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('hides inner message and stack trace behind a collapsible that expands on click', async () => {
    const user = userEvent.setup()
    const error = new DnsApiError('upstream_error', 'Zone already exists.', {
      innerMessage: 'inner detail from upstream',
      stackTrace: 'at Technitium.Dns.Server Foo()',
    })
    renderWithProviders(<ErrorState error={error} />)

    // Collapsed: the detail content is not mounted at all.
    const trigger = screen.getByRole('button', { name: '详细信息' })
    expect(screen.queryByText('inner detail from upstream')).not.toBeInTheDocument()
    expect(screen.queryByText('at Technitium.Dns.Server Foo()')).not.toBeInTheDocument()

    await user.click(trigger)

    expect(screen.getByRole('button', { name: '收起详细信息' })).toBeInTheDocument()
    expect(screen.getByText(/上游消息/)).toBeVisible()
    expect(screen.getByText('inner detail from upstream')).toBeVisible()
    expect(screen.getByText('at Technitium.Dns.Server Foo()')).toBeVisible()
  })

  it('does not render the details collapsible when there is nothing extra to show', () => {
    renderWithProviders(<ErrorState error={new DnsApiError('upstream_error', 'plain message')} />)
    expect(screen.queryByRole('button', { name: '详细信息' })).not.toBeInTheDocument()
  })

  describe('compact', () => {
    it('shows the upstream message verbatim for a DnsApiError', () => {
      renderWithProviders(<ErrorState error={new DnsApiError('upstream_timeout', 'request timed out')} compact />)
      expect(screen.getByRole('alert')).toBeInTheDocument()
      expect(screen.getByText('请求超时')).toBeInTheDocument()
      expect(screen.getByText('request timed out')).toBeInTheDocument()
    })

    it('shows the described message for a non-DnsApiError', () => {
      renderWithProviders(<ErrorState error={new Error('form submission failed')} compact />)
      expect(screen.getByText('发生未知错误')).toBeInTheDocument()
      expect(screen.getByText('form submission failed')).toBeInTheDocument()
    })

    it('renders a retry button when onRetry is provided', async () => {
      const user = userEvent.setup()
      const onRetry = vi.fn()
      renderWithProviders(<ErrorState error={new Error('boom')} onRetry={onRetry} compact />)
      await user.click(screen.getByRole('button', { name: '重试' }))
      expect(onRetry).toHaveBeenCalledTimes(1)
    })
  })
})
