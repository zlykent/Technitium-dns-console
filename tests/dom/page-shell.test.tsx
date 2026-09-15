import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Breadcrumbs, DefinitionList, PageHeader, PageShell, Section } from '@/components/app/page-shell'
import { renderWithProviders } from './utils/render-with-providers'

/**
 * Page furniture is rendered by every console page, so a regression here is a
 * regression everywhere. The behaviours worth locking down are the ones that are
 * structural rather than cosmetic:
 *
 *  - a breadcrumb is a link *only* when it has an `href` and is not the last
 *    crumb. The current page must be inert text with `aria-current="page"` — a
 *    link to the page you are already on is a keyboard trap of pointless tab
 *    stops, and a missing `aria-current` breaks screen-reader orientation.
 *  - `PageShell`'s `gap` prop drives vertical rhythm; the three values must map to
 *    distinct spacing (tailwind-merge collapses the base `gap-6`, so each variant
 *    is asserted to win).
 *  - `Section` renders its title bar only when there is a title or actions, so a
 *    bare content section does not paint an empty bordered header.
 *  - `DefinitionList` must keep each label glued to its value as `<dt>`/`<dd>`
 *    pairs; the read-only detail panels depend on that association.
 */

describe('PageHeader', () => {
  it('renders the title as the page h1 plus the description', () => {
    renderWithProviders(<PageHeader title="区域" description="管理所有 DNS 区域。" />)
    expect(screen.getByRole('heading', { level: 1, name: '区域' })).toBeInTheDocument()
    expect(screen.getByText('管理所有 DNS 区域。')).toBeInTheDocument()
  })

  it('renders the actions cluster', () => {
    renderWithProviders(<PageHeader title="区域" actions={<button type="button">添加区域</button>} />)
    expect(screen.getByRole('button', { name: '添加区域' })).toBeInTheDocument()
  })

  it('renders the footer slot', () => {
    renderWithProviders(<PageHeader title="区域" footer={<div>共 12 个区域</div>} />)
    expect(screen.getByText('共 12 个区域')).toBeInTheDocument()
  })

  it('does not render a breadcrumb nav when there are no breadcrumbs', () => {
    renderWithProviders(<PageHeader title="区域" />)
    expect(screen.queryByRole('navigation', { name: 'breadcrumb' })).not.toBeInTheDocument()
  })

  it('renders an actions-only header without a heading', () => {
    // Top-level modules omit the title: the topbar already names them, so the
    // header must collapse to just the right-aligned action cluster.
    renderWithProviders(<PageHeader actions={<button type="button">刷新</button>} />)
    expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '刷新' })).toBeInTheDocument()
  })
})

describe('Breadcrumbs', () => {
  const items = [
    { label: '控制台', href: '/' },
    { label: '区域', href: '/zones' },
    { label: 'example.com' },
  ]

  it('renders non-final crumbs with an href as links', () => {
    renderWithProviders(<Breadcrumbs items={items} />)
    expect(screen.getByRole('link', { name: '控制台' })).toHaveAttribute('href', '/')
    expect(screen.getByRole('link', { name: '区域' })).toHaveAttribute('href', '/zones')
  })

  it('renders the last crumb as inert current-page text, not a link', () => {
    renderWithProviders(<Breadcrumbs items={items} />)
    expect(screen.queryByRole('link', { name: 'example.com' })).not.toBeInTheDocument()
    expect(screen.getByText('example.com')).toHaveAttribute('aria-current', 'page')
  })

  it('renders the last crumb as text even when it has an href', () => {
    // A link to the page you are already on is a useless tab stop; the `!last`
    // guard is what prevents it, so the href on the final crumb is ignored.
    renderWithProviders(<Breadcrumbs items={[{ label: '首页', href: '/' }, { label: '当前', href: '/current' }]} />)
    expect(screen.queryByRole('link', { name: '当前' })).not.toBeInTheDocument()
    expect(screen.getByText('当前')).toHaveAttribute('aria-current', 'page')
  })

  it('exposes a labelled breadcrumb navigation landmark', () => {
    renderWithProviders(<Breadcrumbs items={items} />)
    expect(screen.getByRole('navigation', { name: 'breadcrumb' })).toBeInTheDocument()
  })
})

describe('PageShell', () => {
  it.each([
    ['sm', 'gap-4'],
    ['md', 'gap-6'],
    ['lg', 'gap-8'],
  ] as const)('maps gap=%s to %s', (gap, expected) => {
    const { container } = renderWithProviders(
      <PageShell gap={gap}>
        <div>content</div>
      </PageShell>,
    )
    expect(container.querySelector('[data-slot="page-shell"]')?.className).toContain(expected)
  })

  it('defaults to the md gap', () => {
    const { container } = renderWithProviders(
      <PageShell>
        <div>content</div>
      </PageShell>,
    )
    expect(container.querySelector('[data-slot="page-shell"]')?.className).toContain('gap-6')
  })
})

describe('Section', () => {
  it('renders the title and description in a heading', () => {
    renderWithProviders(<Section title="转发器" description="上游 DNS 服务器。">内容</Section>)
    expect(screen.getByRole('heading', { level: 2, name: '转发器' })).toBeInTheDocument()
    expect(screen.getByText('上游 DNS 服务器。')).toBeInTheDocument()
    expect(screen.getByText('内容')).toBeInTheDocument()
  })

  it('renders the actions on the right of the title bar when provided', () => {
    renderWithProviders(
      <Section title="转发器" actions={<button type="button">添加</button>}>
        内容
      </Section>,
    )
    expect(screen.getByRole('button', { name: '添加' })).toBeInTheDocument()
  })

  it('omits the title bar entirely when neither title nor actions are given', () => {
    const { container } = renderWithProviders(<Section>仅内容</Section>)
    expect(screen.queryByRole('heading', { level: 2 })).not.toBeInTheDocument()
    expect(screen.getByText('仅内容')).toBeInTheDocument()
    // The bordered header row must not be painted for a bare content section.
    expect(container.querySelector('[data-slot="section"] > div.border-b')).toBeNull()
  })
})

describe('DefinitionList', () => {
  const items = [
    { label: '名称', value: 'example.com' },
    { label: '类型', value: 'A' },
  ]

  it('pairs each label with its value as dt/dd', () => {
    const { container } = renderWithProviders(<DefinitionList items={items} />)
    const list = container.querySelector('[data-slot="definition-list"]')
    expect(list?.querySelectorAll('dt')).toHaveLength(2)
    expect(list?.querySelectorAll('dd')).toHaveLength(2)
    expect(screen.getByText('名称')).toBeInTheDocument()
    expect(screen.getByText('example.com')).toBeInTheDocument()
    expect(screen.getByText('类型')).toBeInTheDocument()
    expect(screen.getByText('A')).toBeInTheDocument()
  })

  it('keeps the value adjacent to its label within the same row', () => {
    // The dt and dd for one item share a wrapper div; if that grouping breaks the
    // two-column grid interleaves labels and values incorrectly.
    const { container } = renderWithProviders(<DefinitionList items={items} />)
    const firstRow = container.querySelector('[data-slot="definition-list"] > div')
    expect(firstRow?.querySelector('dt')?.textContent).toBe('名称')
    expect(firstRow?.querySelector('dd')?.textContent).toBe('example.com')
  })
})
