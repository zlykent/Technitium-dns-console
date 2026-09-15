import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DomainTree, queryKeyForScope, type DomainTreeProps } from '@/components/filtering/domain-tree'
import { DnsApiError } from '@/lib/api/errors'
import type { DomainTreeResult, TreeListParams, TreeRecord } from '@/lib/api/types/filtering'
import type { FilterScope } from '@/lib/api/domains/filtering'
import { renderWithProviders } from './utils/render-with-providers'

/**
 * The lazy domain tree.
 *
 * `DomainTree` renders exactly one level of the cache/allowed/blocked API and
 * lets the operator expand a child to fetch its own subtree on demand. The
 * regressions worth guarding are the ones a snapshot cannot see:
 *
 *  - a collapsed node must not fetch its children (that is the whole point of a
 *    *lazy* tree — an eager one would fan out a request per zone on first paint);
 *  - expanding really mounts the nested level and indents it one step deeper, and
 *    collapsing unmounts it again;
 *  - every action callback carries the *full* domain (`sub.example.com`), not the
 *    truncated label the operator sees (`sub`) — a delete/navigate wired to the
 *    label would target the wrong name;
 *  - the four chrome states (loading skeleton, depth-0 empty, depth>0 "no
 *    records", error+retry) are chosen by depth and query status, and getting
 *    that branch wrong tells an operator a populated cache is empty;
 *  - `expandable={false}` is the flat-list mode: no chevron, and clicking the
 *    name navigates instead of expanding inline.
 *
 * `listTree` is mocked at the API-domain boundary (the component's only data
 * source) and `useTargetKey` at the provider boundary, so no network or
 * localStorage-backed server store is involved. React Query itself is real, which
 * is what makes the "collapsed node does not fetch" assertion meaningful.
 */

const { mockListTree } = vi.hoisted(() => ({
  mockListTree: vi.fn<(scope: FilterScope, params?: TreeListParams) => Promise<DomainTreeResult>>(),
}))

vi.mock('@/lib/api/domains/filtering', () => ({ listTree: mockListTree }))
vi.mock('@/lib/servers/provider', () => ({ useTargetKey: () => 'test-target' }))

/** One level per domain; the root is keyed by the empty string. */
const TREE: Record<string, DomainTreeResult> = {
  '': { domain: '', zones: ['example.com', 'test.net'], records: [] },
  'example.com': { domain: 'example.com', zones: ['sub.example.com'], records: [] },
  'sub.example.com': { domain: 'sub.example.com', zones: [], records: [] },
  'test.net': { domain: 'test.net', zones: [], records: [] },
}

function treeImpl(_scope: FilterScope, params?: TreeListParams): Promise<DomainTreeResult> {
  const domain = params?.domain ?? ''
  return Promise.resolve(TREE[domain] ?? { domain, zones: [], records: [] })
}

function aRecord(overrides: Partial<TreeRecord> = {}): TreeRecord {
  return {
    name: 'www.example.com',
    type: 'A',
    ttl: 3600,
    ttlString: '1h',
    expiryTtl: null,
    expiryTtlString: null,
    disabled: false,
    dnssecStatus: 'Unsigned',
    lastModified: '2026-01-01T00:00:00Z',
    lastUsedOn: null,
    rData: { ipAddress: '192.0.2.1' },
    ...overrides,
  }
}

/** Mount the tree with a fixed set of records at the root and wait for the row. */
async function renderRecords(records: TreeRecord[]) {
  mockListTree.mockReset()
  mockListTree.mockResolvedValue({ domain: '', zones: [], records })
  renderTree()
  await screen.findByText('www.example.com')
}

function renderTree(props: Partial<DomainTreeProps> = {}) {
  return renderWithProviders(<DomainTree scope="cache" domain="" {...props} />)
}

/** The row `<div>` that carries a node's indentation and holds its buttons. */
function nodeRow(label: string): HTMLElement {
  const row = screen.getByRole('button', { name: label }).parentElement
  if (!row) throw new Error(`no row rendered for label ${label}`)
  return row
}

beforeEach(() => {
  mockListTree.mockReset()
  mockListTree.mockImplementation(treeImpl)
})

describe('queryKeyForScope', () => {
  it('builds the per-scope query key with the domain in the keyword slot', () => {
    // Page is always 0 for a lazy tree; the browsed node travels in `keyword`, so
    // switching servers (target) or scopes can never collide in the cache.
    expect(queryKeyForScope('cache', 'srv', 'example.com')).toEqual([
      'srv',
      'cache',
      { page: 0, keyword: 'example.com' },
    ])
    expect(queryKeyForScope('allowed', 'srv', 'a.com')).toEqual([
      'srv',
      'allowed',
      { page: 0, keyword: 'a.com' },
    ])
    expect(queryKeyForScope('blocked', 'srv', 'b.com')).toEqual([
      'srv',
      'blocked',
      { page: 0, keyword: 'b.com' },
    ])
  })
})

describe('DomainTree — chrome states', () => {
  it('renders the loading skeleton while the level is pending', () => {
    // A never-resolving promise keeps the query pending so we observe the
    // skeleton deterministically instead of racing the microtask that resolves it.
    mockListTree.mockReset()
    mockListTree.mockReturnValue(new Promise<DomainTreeResult>(() => {}))
    renderTree()
    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(screen.getByText('加载中…')).toBeInTheDocument()
  })

  it('renders the scope-specific empty state at depth 0', async () => {
    mockListTree.mockReset()
    mockListTree.mockResolvedValue({ domain: '', zones: [], records: [] })
    renderTree({ scope: 'blocked' })
    expect(await screen.findByText('阻止列表为空')).toBeInTheDocument()
  })

  it('renders the cache empty title for the cache scope', async () => {
    mockListTree.mockReset()
    mockListTree.mockResolvedValue({ domain: '', zones: [], records: [] })
    renderTree({ scope: 'cache' })
    expect(await screen.findByText('解析器缓存当前为空')).toBeInTheDocument()
  })

  it('renders "no records" (not the empty state) when a deeper node is empty', async () => {
    // depth > 0 with nothing beneath is a normal leaf, not an empty list — the
    // copy must differ so an operator is not told the whole cache is empty.
    mockListTree.mockReset()
    mockListTree.mockResolvedValue({ domain: 'leaf.example', zones: [], records: [] })
    renderTree({ domain: 'leaf.example', depth: 1 })
    expect(await screen.findByText('该域名下没有缓存记录')).toBeInTheDocument()
    expect(screen.queryByText('解析器缓存当前为空')).not.toBeInTheDocument()
  })

  it('renders the error state and refetches on retry', async () => {
    const user = userEvent.setup()
    mockListTree.mockReset()
    mockListTree.mockImplementation(treeImpl)
    mockListTree.mockRejectedValueOnce(new DnsApiError('upstream_unreachable', 'no route to host'))
    renderTree()

    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(screen.getByText('无法连接到 DNS 服务器')).toBeInTheDocument()

    // The next call (the retry) falls through to the resolving implementation.
    await user.click(screen.getByRole('button', { name: '重试' }))
    expect(await screen.findByRole('button', { name: 'example' })).toBeInTheDocument()
  })
})

describe('DomainTree — lazy expansion', () => {
  it('renders each root zone as a node labelled by its first DNS label', async () => {
    renderTree()
    // domainLabel('example.com') === 'example'; the operator sees the short label
    // while the full domain lives in the button's title.
    expect(await screen.findByRole('button', { name: 'example' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'test' })).toBeInTheDocument()
  })

  it('does not fetch a child level until its node is expanded', async () => {
    renderTree()
    await screen.findByRole('button', { name: 'example' })
    // Only the root has been requested; the two collapsed children are lazy.
    expect(mockListTree).toHaveBeenCalledTimes(1)
    expect(mockListTree).toHaveBeenCalledWith('cache', { domain: '' })
  })

  it('fetches and mounts the nested level on expand, then unmounts on collapse', async () => {
    const user = userEvent.setup()
    renderTree()
    await screen.findByRole('button', { name: 'example' })
    const chevron = within(nodeRow('example')).getByRole('button', { name: '展开子域' })
    expect(chevron).toHaveAttribute('aria-expanded', 'false')

    await user.click(chevron)

    // The nested node for sub.example.com appears with its own short label.
    expect(await screen.findByRole('button', { name: 'sub' })).toBeInTheDocument()
    expect(mockListTree).toHaveBeenCalledWith('cache', { domain: 'example.com' })
    expect(within(nodeRow('example')).getByRole('button', { name: '全部收起' })).toHaveAttribute(
      'aria-expanded',
      'true',
    )

    await user.click(within(nodeRow('example')).getByRole('button', { name: '全部收起' }))
    expect(screen.queryByRole('button', { name: 'sub' })).not.toBeInTheDocument()
  })

  it('indents a nested node one step deeper than its parent', async () => {
    const user = userEvent.setup()
    renderTree()
    await screen.findByRole('button', { name: 'example' })
    // depth 0 -> 0*16+8 = 8px
    expect(nodeRow('example')).toHaveStyle({ paddingLeft: '8px' })

    await user.click(within(nodeRow('example')).getByRole('button', { name: '展开子域' }))
    await screen.findByRole('button', { name: 'sub' })

    // depth 1 -> 1*16+8 = 24px, so the hierarchy is visually legible.
    expect(nodeRow('sub')).toHaveStyle({ paddingLeft: '24px' })
  })

  it('shows the child-count badge once a node with children is expanded', async () => {
    const user = userEvent.setup()
    renderTree()
    await screen.findByRole('button', { name: 'example' })
    await user.click(within(nodeRow('example')).getByRole('button', { name: '展开子域' }))
    await screen.findByRole('button', { name: 'sub' })
    expect(within(nodeRow('example')).getByText('1 个子域')).toBeInTheDocument()
  })

  it('expands children immediately when defaultExpanded is set', async () => {
    renderTree({ defaultExpanded: true })
    // No click: the node starts expanded and its subtree is fetched on mount.
    expect(await screen.findByRole('button', { name: 'sub' })).toBeInTheDocument()
  })
})

describe('DomainTree — node actions carry the full domain', () => {
  it('calls onNavigate with the full domain when the label is clicked', async () => {
    const user = userEvent.setup()
    const onNavigate = vi.fn()
    renderTree({ onNavigate })
    await user.click(await screen.findByRole('button', { name: 'example' }))
    expect(onNavigate).toHaveBeenCalledWith('example.com')
  })

  it('calls onDelete with the full domain from the row delete button', async () => {
    const user = userEvent.setup()
    const onDelete = vi.fn()
    renderTree({ canDelete: true, onDelete })
    await screen.findByRole('button', { name: 'example' })
    await user.click(within(nodeRow('example')).getByRole('button', { name: '删除' }))
    expect(onDelete).toHaveBeenCalledWith('example.com')
  })

  it('renders no delete button when canDelete is false', async () => {
    const onDelete = vi.fn()
    renderTree({ canDelete: false, onDelete })
    await screen.findByRole('button', { name: 'example' })
    expect(screen.queryByRole('button', { name: '删除' })).not.toBeInTheDocument()
  })

  it('reflects the selected set and calls onToggleSelect with the full domain', async () => {
    const user = userEvent.setup()
    const onToggleSelect = vi.fn()
    renderTree({ onToggleSelect, selected: new Set(['example.com']) })
    await screen.findByRole('button', { name: 'example' })

    expect(within(nodeRow('example')).getByRole('checkbox', { name: '选择此行' })).toBeChecked()
    expect(within(nodeRow('test')).getByRole('checkbox', { name: '选择此行' })).not.toBeChecked()

    await user.click(within(nodeRow('test')).getByRole('checkbox', { name: '选择此行' }))
    expect(onToggleSelect).toHaveBeenCalledWith('test.net')
  })

  it('renders no checkbox when onToggleSelect is omitted', async () => {
    renderTree()
    await screen.findByRole('button', { name: 'example' })
    expect(screen.queryByRole('checkbox', { name: '选择此行' })).not.toBeInTheDocument()
  })
})

describe('DomainTree — records at a node', () => {
  it('renders the records heading and the record name when the level has records', async () => {
    mockListTree.mockReset()
    mockListTree.mockResolvedValue({ domain: '', zones: [], records: [aRecord()] })
    renderTree()
    expect(await screen.findByRole('heading', { name: /记录/ })).toBeInTheDocument()
    expect(screen.getByText('www.example.com')).toBeInTheDocument()
  })

  it('does not render the records section when the level has no records', async () => {
    renderTree()
    await screen.findByRole('button', { name: 'example' })
    expect(screen.queryByRole('heading', { name: /记录/ })).not.toBeInTheDocument()
  })
})

/**
 * The cache/allowed/blocked tree reuses one table for two different upstream
 * record shapes (see `TreeRecord`). These guard the fields that silently broke
 * when the table assumed the authoritative shape: a cache TTL is a pre-rendered
 * string, expiry/disabled/comments are authoritative-only, and ECS/glue/stale
 * are cache-only. A regression here shows up as an empty cell, not an error.
 */
describe('DomainTree — record cells across cache/authoritative shapes', () => {
  it('renders a cache TTL string verbatim instead of coercing it to NaN', async () => {
    // Cache carries "300 (5m)" with no separate ttlString; formatTtl would
    // Number()-coerce it to NaN and the cell would read "—".
    await renderRecords([aRecord({ ttl: '300 (5m)', ttlString: undefined })])
    expect(screen.getByText('300 (5m)')).toBeInTheDocument()
  })

  it('flags a stale cache entry whose TTL has run out', async () => {
    await renderRecords([aRecord({ ttl: '0 (0s)', ttlString: undefined })])
    expect(screen.getByText('已失效')).toBeInTheDocument()
  })

  it('surfaces cache-only EDNS client subnet and glue records', async () => {
    await renderRecords([
      aRecord({
        ttl: '60 (1m)',
        eDnsClientSubnet: '192.0.2.0/24',
        glueRecords: ['198.51.100.1', '198.51.100.2'],
      }),
    ])
    expect(screen.getByText(/ECS 192\.0\.2\.0\/24/)).toBeInTheDocument()
    expect(screen.getByText(/胶水记录 ×2/)).toBeInTheDocument()
  })

  it('renders authoritative expiry, comments and a disabled badge on the name', async () => {
    await renderRecords([
      aRecord({ ttl: 3600, ttlString: '1h', expiryTtlString: '30m', comments: 'primary A', disabled: true }),
    ])
    expect(screen.getByText(/到期: 30m/)).toBeInTheDocument()
    expect(screen.getByText('primary A')).toBeInTheDocument()
    expect(screen.getByText('已禁用')).toBeInTheDocument()
  })

  it('shows the validated badge when a cache answer carried RRSIG/NSEC', async () => {
    await renderRecords([
      aRecord({ ttl: '120 (2m)', dnssecStatus: 'Unsigned', dnssecRecords: ['RRSIG A 8 3 120'] }),
    ])
    expect(screen.getByText('已验证')).toBeInTheDocument()
  })

  it('omits the details column entirely for a plain answer with nothing extra', async () => {
    // >3 records so the header renders (hideHeader is `records.length <= 3`) —
    // the header is the only way to observe that the details column did not
    // mount, keeping a plain cache table free of an always-empty cell.
    const plain = ['a.example.com', 'b.example.com', 'c.example.com', 'd.example.com'].map((name) =>
      aRecord({ name, ttl: '300 (5m)', ttlString: undefined }),
    )
    mockListTree.mockReset()
    mockListTree.mockResolvedValue({ domain: '', zones: [], records: plain })
    renderTree()
    await screen.findByText('a.example.com')
    expect(screen.getByText('名称')).toBeInTheDocument()
    expect(screen.queryByText('详情')).not.toBeInTheDocument()
  })
})

describe('DomainTree — flat list mode', () => {
  it('hides the chevron and navigates instead of expanding when expandable is false', async () => {
    const user = userEvent.setup()
    const onNavigate = vi.fn()
    renderTree({ expandable: false, onNavigate })
    await screen.findByRole('button', { name: 'example' })

    // Flat mode has no inline expansion affordance at all.
    expect(screen.queryByRole('button', { name: '展开子域' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'example' }))
    expect(onNavigate).toHaveBeenCalledWith('example.com')
    // The nested level must not mount, because clicking navigates rather than expands.
    expect(screen.queryByRole('button', { name: 'sub' })).not.toBeInTheDocument()
  })
})
