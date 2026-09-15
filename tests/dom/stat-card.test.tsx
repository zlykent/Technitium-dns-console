import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { StatCard, StatGrid, StatGridSkeleton } from '@/components/app/stat-card'
import { renderWithProviders } from './utils/render-with-providers'

/**
 * The dashboard is a wall of these tiles, so the regressions that matter are the
 * ones an operator would feel but not name:
 *
 *  - the tone is carried *only* by the 2px left accent bar (no text changes), so
 *    a broken `TONE_BAR` mapping makes a "danger" tile indistinguishable from a
 *    neutral one. The bar's colour class is the single observable signal and is
 *    asserted per tone.
 *  - `onClick` switches the root element from a `div` to a `button`. Getting that
 *    wrong silently removes keyboard access and the button role from a metric that
 *    is meant to drill down, so both directions are asserted.
 *  - `loading` must swap the value for a skeleton; a tile that shows a stale value
 *    while refetching lies about the number.
 *  - `tabular-nums` on the value is what stops digits jittering as a live counter
 *    updates; it is easy to drop during a class refactor and invisible in a diff.
 */

function accentBar(container: HTMLElement): HTMLElement {
  const card = container.querySelector('[data-slot="stat-card"]')
  if (!card || !card.firstElementChild) throw new Error('stat card accent bar not found')
  return card.firstElementChild as HTMLElement
}

describe('StatCard', () => {
  it.each([
    ['neutral', 'bg-border'],
    ['primary', 'bg-primary'],
    ['success', 'bg-success'],
    ['warning', 'bg-warning'],
    ['danger', 'bg-destructive'],
    ['info', 'bg-info'],
  ] as const)('paints the %s accent bar with %s', (tone, expected) => {
    const { container } = renderWithProviders(<StatCard label="查询" value="42" tone={tone} />)
    expect(accentBar(container).className).toContain(expected)
  })

  it('renders a skeleton in place of the value while loading', () => {
    const { container } = renderWithProviders(<StatCard label="查询" value="42" loading />)
    expect(container.querySelector('[data-slot="skeleton"]')).toBeInTheDocument()
    expect(screen.queryByText('42')).not.toBeInTheDocument()
  })

  it('is a real button with button semantics when onClick is provided', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    renderWithProviders(<StatCard label="查询" value="42" onClick={onClick} />)
    const button = screen.getByRole('button')
    expect(button).toHaveAttribute('type', 'button')
    await user.click(button)
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('is not a button when onClick is absent', () => {
    const { container } = renderWithProviders(<StatCard label="查询" value="42" />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(container.querySelector('[data-slot="stat-card"]')?.tagName).toBe('DIV')
  })

  it('applies tabular-nums to the value so live counters do not jitter', () => {
    renderWithProviders(<StatCard label="查询" value="1234567" />)
    expect(screen.getByText('1234567')).toHaveClass('tabular-nums')
  })

  it('renders hint and trailing slots', () => {
    renderWithProviders(<StatCard label="查询" value="42" hint="过去 24 小时" trailing={<span>趋势</span>} />)
    expect(screen.getByText('过去 24 小时')).toBeInTheDocument()
    expect(screen.getByText('趋势')).toBeInTheDocument()
  })
})

describe('StatGrid', () => {
  it.each([
    [2, 'sm:grid-cols-2'],
    [3, 'lg:grid-cols-3'],
    [4, 'lg:grid-cols-4'],
    [6, 'xl:grid-cols-6'],
  ] as const)('maps columns=%i to the %s breakpoint class', (columns, expected) => {
    const { container } = renderWithProviders(
      <StatGrid columns={columns}>
        <StatCard label="a" value="1" />
      </StatGrid>,
    )
    const grid = container.querySelector('[data-slot="stat-grid"]')
    expect(grid?.className).toContain(expected)
  })

  it('defaults to a four-column grid', () => {
    const { container } = renderWithProviders(
      <StatGrid>
        <StatCard label="a" value="1" />
      </StatGrid>,
    )
    expect(container.querySelector('[data-slot="stat-grid"]')?.className).toContain('lg:grid-cols-4')
  })
})

describe('StatGridSkeleton', () => {
  it('renders the requested number of placeholder cards', () => {
    const { container } = renderWithProviders(<StatGridSkeleton count={3} />)
    expect(container.querySelectorAll('[data-slot="stat-card"]')).toHaveLength(3)
    // Each placeholder card shows two skeletons: the label bar and the value bar.
    expect(container.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(6)
  })
})
