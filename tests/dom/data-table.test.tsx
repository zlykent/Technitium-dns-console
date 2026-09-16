import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { DataTable, textColumn } from '@/components/app/data-table'
import { DnsApiError } from '@/lib/api/errors'
import { renderWithProviders } from './utils/render-with-providers'

/**
 * One `DataTable` drives every list in the console (zones, records, cache,
 * leases, logs, users, sessions…), and it has to serve two opposite pagination
 * models because Technitium does: `zones/list` paginates server-side while
 * `dhcp/leases/list` returns everything and is paged in the browser. The
 * regressions worth guarding are the branching decisions that are easy to invert
 * and silent when wrong:
 *
 *  - empty ("no data yet") vs no-results ("your filter matched nothing") must be
 *    chosen by whether a `globalFilter` is active, so an operator is never told a
 *    zone list is empty when they merely typed a bad search.
 *  - client pagination slices locally and flipping a page really swaps the rows;
 *    server pagination must delegate to `onPageChange`/`onPageSizeChange` and never
 *    slice on its own (that would drop rows the server already paged).
 *  - a filter change resets to page 1 — otherwise filtering to three rows while
 *    sitting on page 7 shows an empty table.
 *  - sorting supports both controlled (server) and uncontrolled (client) modes.
 *  - row selection feeds `selectionActions` the exact id list from `getRowId`.
 *  - `meta.align` reaches the rendered cells, `onRowClick`, `hideHeader` and
 *    `footerNote` behave as documented.
 */

interface Zone {
  id: string
  name: string
  records: number
}

function zoneColumns() {
  return [
    textColumn<Zone>({ accessorKey: 'name', header: '名称' }),
    textColumn<Zone>({ accessorKey: 'records', header: '记录数', align: 'right' }),
  ]
}

const ZONES: Zone[] = [
  { id: 'a', name: 'alpha.com', records: 30 },
  { id: 'b', name: 'beta.com', records: 10 },
  { id: 'c', name: 'gamma.com', records: 20 },
]

const FIVE: Zone[] = [
  { id: 'z1', name: 'z1', records: 1 },
  { id: 'z2', name: 'z2', records: 2 },
  { id: 'z3', name: 'z3', records: 3 },
  { id: 'z4', name: 'z4', records: 4 },
  { id: 'z5', name: 'z5', records: 5 },
]

/** Radix Select (the page-size control) needs pointer-capture APIs jsdom lacks. */
beforeAll(() => {
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false
    Element.prototype.setPointerCapture = () => {}
    Element.prototype.releasePointerCapture = () => {}
  }
})

function dataRows(): HTMLElement[] {
  // Row 0 is the header row; the rest are body rows.
  return screen.getAllByRole('row').slice(1)
}

describe('DataTable — empty vs no-results', () => {
  it('shows the default empty state when there is no data and no filter', () => {
    renderWithProviders(<DataTable columns={zoneColumns()} data={[]} getRowId={(r) => r.id} />)
    expect(screen.getByText('暂无数据')).toBeInTheDocument()
    expect(screen.getByText('调整筛选条件或创建第一条记录。')).toBeInTheDocument()
  })

  it('honours a custom empty title and body', () => {
    renderWithProviders(
      <DataTable
        columns={zoneColumns()}
        data={[]}
        getRowId={(r) => r.id}
        empty={{ title: '还没有区域', body: '创建第一个区域以开始解析。' }}
      />,
    )
    expect(screen.getByText('还没有区域')).toBeInTheDocument()
    expect(screen.getByText('创建第一个区域以开始解析。')).toBeInTheDocument()
  })

  it('switches to the no-results state when a global filter matches nothing', () => {
    // Same zero-row render, but because a filter is active the operator must be
    // told "no matches", not "no data".
    renderWithProviders(<DataTable columns={zoneColumns()} data={ZONES} getRowId={(r) => r.id} globalFilter="zzz" />)
    expect(screen.getByText('没有匹配的结果')).toBeInTheDocument()
    expect(screen.queryByText('暂无数据')).not.toBeInTheDocument()
  })

  it('honours a custom no-results title', () => {
    renderWithProviders(
      <DataTable
        columns={zoneColumns()}
        data={ZONES}
        getRowId={(r) => r.id}
        globalFilter="zzz"
        noResults={{ title: '没有匹配的区域' }}
      />,
    )
    expect(screen.getByText('没有匹配的区域')).toBeInTheDocument()
  })
})

describe('DataTable — loading and error', () => {
  it('renders the skeleton loading state', () => {
    renderWithProviders(<DataTable columns={zoneColumns()} data={[]} getRowId={(r) => r.id} loading />)
    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(screen.getByText('加载中…')).toBeInTheDocument()
    // The empty state must not show through while loading.
    expect(screen.queryByText('暂无数据')).not.toBeInTheDocument()
  })

  it('renders the error state and wires onRetry', async () => {
    const user = userEvent.setup()
    const onRetry = vi.fn()
    renderWithProviders(
      <DataTable
        columns={zoneColumns()}
        data={[]}
        getRowId={(r) => r.id}
        error={new DnsApiError('upstream_unreachable', 'no route to host')}
        onRetry={onRetry}
      />,
    )
    expect(screen.getByText('无法连接到 DNS 服务器')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '重试' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })
})

describe('DataTable — client pagination', () => {
  it('slices rows locally and flipping the page swaps the visible rows', async () => {
    const user = userEvent.setup()
    renderWithProviders(
      <DataTable columns={zoneColumns()} data={FIVE} getRowId={(r) => r.id} clientPagination={{ pageSize: 2 }} />,
    )
    expect(screen.getByText('z1')).toBeInTheDocument()
    expect(screen.getByText('z2')).toBeInTheDocument()
    expect(screen.queryByText('z3')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '下一页' }))

    expect(screen.getByText('z3')).toBeInTheDocument()
    expect(screen.getByText('z4')).toBeInTheDocument()
    expect(screen.queryByText('z1')).not.toBeInTheDocument()
  })

  it('does not render pagination when everything fits on one page', () => {
    renderWithProviders(<DataTable columns={zoneColumns()} data={ZONES} getRowId={(r) => r.id} />)
    expect(screen.queryByRole('button', { name: '下一页' })).not.toBeInTheDocument()
  })

  it('resets to page 1 when the global filter changes', async () => {
    const user = userEvent.setup()
    const { rerender } = renderWithProviders(
      <DataTable columns={zoneColumns()} data={FIVE} getRowId={(r) => r.id} clientPagination={{ pageSize: 2 }} globalFilter="" />,
    )
    await user.click(screen.getByRole('button', { name: '下一页' }))
    expect(screen.getByText('z3')).toBeInTheDocument()

    // A filter that still matches several rows must throw the operator back to
    // page 1 rather than strand them on an out-of-range page.
    rerender(
      <DataTable columns={zoneColumns()} data={FIVE} getRowId={(r) => r.id} clientPagination={{ pageSize: 2 }} globalFilter="z" />,
    )
    expect(screen.getByText('z1')).toBeInTheDocument()
    expect(screen.queryByText('z3')).not.toBeInTheDocument()
  })
})

describe('DataTable — server pagination', () => {
  it('delegates page changes to onPageChange without slicing locally', async () => {
    const user = userEvent.setup()
    const onPageChange = vi.fn()
    renderWithProviders(
      <DataTable
        columns={zoneColumns()}
        data={[ZONES[0], ZONES[1]]}
        getRowId={(r) => r.id}
        server={{ page: 1, pageSize: 2, total: 6, totalPages: 3, onPageChange }}
      />,
    )
    await user.click(screen.getByRole('button', { name: '下一页' }))
    expect(onPageChange).toHaveBeenCalledWith(2)
    // The rows shown are exactly what the server sent; the table did not re-slice.
    expect(screen.getByText('alpha.com')).toBeInTheDocument()
    expect(screen.getByText('beta.com')).toBeInTheDocument()
  })

  it('jumps to a specific page via the numbered control', async () => {
    const user = userEvent.setup()
    const onPageChange = vi.fn()
    renderWithProviders(
      <DataTable
        columns={zoneColumns()}
        data={[ZONES[0], ZONES[1]]}
        getRowId={(r) => r.id}
        server={{ page: 1, pageSize: 2, total: 6, totalPages: 3, onPageChange }}
      />,
    )
    await user.click(screen.getByRole('button', { name: 'Page 3' }))
    expect(onPageChange).toHaveBeenCalledWith(3)
  })

  it('calls onPageSizeChange when the page-size select changes', async () => {
    const user = userEvent.setup()
    const onPageSizeChange = vi.fn()
    renderWithProviders(
      <DataTable
        columns={zoneColumns()}
        data={[ZONES[0]]}
        getRowId={(r) => r.id}
        server={{ page: 1, pageSize: 10, total: 60, totalPages: 6, onPageChange: vi.fn(), onPageSizeChange }}
      />,
    )
    await user.click(screen.getByRole('combobox'))
    await user.click(await screen.findByRole('option', { name: '20' }))
    expect(onPageSizeChange).toHaveBeenCalledWith(20)
  })
})

describe('DataTable — sorting', () => {
  it('sorts client-side when uncontrolled', async () => {
    const user = userEvent.setup()
    renderWithProviders(<DataTable columns={zoneColumns()} data={ZONES} getRowId={(r) => r.id} />)
    // TanStack's getAutoSortDir returns 'desc' for a numeric column (largest
    // first), so the first click on 记录数 orders 30 → 20 → 10.
    await user.click(screen.getByRole('button', { name: /记录数/ }))
    expect(dataRows().map((row) => within(row).getByText(/\.com/).textContent)).toEqual([
      'alpha.com',
      'gamma.com',
      'beta.com',
    ])

    // A second click flips the direction to ascending.
    await user.click(screen.getByRole('button', { name: /记录数/ }))
    expect(dataRows().map((row) => within(row).getByText(/\.com/).textContent)).toEqual([
      'beta.com',
      'gamma.com',
      'alpha.com',
    ])
  })

  it('defers to onSortingChange and does not self-sort when controlled', async () => {
    const user = userEvent.setup()
    const onSortingChange = vi.fn()
    renderWithProviders(
      <DataTable columns={zoneColumns()} data={ZONES} getRowId={(r) => r.id} sorting={[]} onSortingChange={onSortingChange} />,
    )
    await user.click(screen.getByRole('button', { name: /记录数/ }))
    expect(onSortingChange).toHaveBeenCalled()
    // Because the controlled `sorting` stays [], the row order is unchanged.
    expect(within(dataRows()[0]).getByText('alpha.com')).toBeInTheDocument()
  })
})

describe('DataTable — row selection', () => {
  it('passes the selected row ids to selectionActions', async () => {
    const user = userEvent.setup()
    renderWithProviders(
      <DataTable
        columns={zoneColumns()}
        data={ZONES}
        getRowId={(r) => r.id}
        enableRowSelection
        selectionActions={(ids) => <button type="button">删除 {ids.join(',')}</button>}
      />,
    )
    // No selection bar until something is selected.
    expect(screen.queryByRole('button', { name: /删除/ })).not.toBeInTheDocument()

    const rowCheckboxes = screen.getAllByRole('checkbox', { name: '选择此行' })
    await user.click(rowCheckboxes[0])

    expect(screen.getByText('已选择 1 项')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '删除 a' })).toBeInTheDocument()
  })

  it('selects the whole page via the header checkbox', async () => {
    const user = userEvent.setup()
    renderWithProviders(
      <DataTable
        columns={zoneColumns()}
        data={ZONES}
        getRowId={(r) => r.id}
        enableRowSelection
        selectionActions={(ids) => <button type="button">删除 {ids.join(',')}</button>}
      />,
    )
    await user.click(screen.getByRole('checkbox', { name: '选择当前页全部行' }))
    expect(screen.getByText('已选择 3 项')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '删除 a,b,c' })).toBeInTheDocument()
  })
})

describe('DataTable — columns, rows and chrome', () => {
  it('applies meta.align to both the header and body cells', () => {
    renderWithProviders(<DataTable columns={zoneColumns()} data={ZONES} getRowId={(r) => r.id} />)
    expect(screen.getByRole('columnheader', { name: /记录数/ }).className).toContain('text-right')
    const recordsCell = within(dataRows()[0]).getAllByRole('cell')[1]
    expect(recordsCell.className).toContain('text-right')
  })

  it('renders a custom cell renderer from textColumn', () => {
    const columns = [
      textColumn<Zone>({ accessorKey: 'name', header: '名称' }),
      textColumn<Zone>({ accessorKey: 'records', header: '记录数', cell: (value) => <strong>{String(value)} 条</strong> }),
    ]
    renderWithProviders(<DataTable columns={columns} data={ZONES} getRowId={(r) => r.id} />)
    expect(screen.getByText('30 条')).toBeInTheDocument()
  })

  it('invokes onRowClick with the row data', async () => {
    const user = userEvent.setup()
    const onRowClick = vi.fn()
    renderWithProviders(<DataTable columns={zoneColumns()} data={ZONES} getRowId={(r) => r.id} onRowClick={onRowClick} />)
    await user.click(within(dataRows()[1]).getByText('beta.com'))
    expect(onRowClick).toHaveBeenCalledWith(ZONES[1])
  })

  it('hides the header row when hideHeader is set', () => {
    renderWithProviders(<DataTable columns={zoneColumns()} data={ZONES} getRowId={(r) => r.id} hideHeader />)
    expect(screen.queryByRole('columnheader')).not.toBeInTheDocument()
    // Body rows are still rendered.
    expect(screen.getByText('alpha.com')).toBeInTheDocument()
  })

  it('renders the footer note', () => {
    renderWithProviders(
      <DataTable columns={zoneColumns()} data={ZONES} getRowId={(r) => r.id} footerNote="共 3 个区域" />,
    )
    expect(screen.getByText('共 3 个区域')).toBeInTheDocument()
  })

  it('renders the toolbar slot', () => {
    renderWithProviders(
      <DataTable columns={zoneColumns()} data={ZONES} getRowId={(r) => r.id} toolbar={<button type="button">添加区域</button>} />,
    )
    expect(screen.getByRole('button', { name: '添加区域' })).toBeInTheDocument()
  })

  it('exposes the table with the provided aria label', () => {
    renderWithProviders(<DataTable columns={zoneColumns()} data={ZONES} getRowId={(r) => r.id} label="区域列表" />)
    expect(screen.getByRole('table', { name: '区域列表' })).toBeInTheDocument()
  })
})

describe('DataTable — flex column lets the table shrink', () => {
  // A flex column is the one column allowed to wrap when the container is
  // narrower than the content, which only works once the table drops
  // `min-w-max`. On wide screens a flex table splits its width evenly between
  // the columns — an earlier `width: 100%` absorber turned the primary column
  // into a ~1400px banner on a 2560px monitor, and content-proportional
  // sharing then gave the longest text two thirds of it. These pin both
  // halves.
  it('keeps min-w-max and leaves every column width to auto layout when no column is flex', () => {
    renderWithProviders(<DataTable columns={zoneColumns()} data={ZONES} getRowId={(r) => r.id} />)
    expect(screen.getByRole('table').className).toContain('min-w-max')
    // No inline widths: a non-flex table stays content-proportional.
    for (const head of screen.getAllByRole('columnheader')) {
      expect(head.style.width).toBe('')
    }
  })

  it('drops min-w-max and gives every column an equal share', () => {
    const columns = [
      textColumn<Zone>({ accessorKey: 'name', header: '名称', flex: true }),
      textColumn<Zone>({ accessorKey: 'records', header: '记录数', align: 'right', hug: true }),
    ]
    renderWithProviders(<DataTable columns={columns} data={ZONES} getRowId={(r) => r.id} />)
    expect(screen.getByRole('table').className).not.toContain('min-w-max')
    // Even shares, including the flex column itself; auto layout floors each
    // at its content, so the percentages are a preference, never a clip.
    expect(screen.getByRole('columnheader', { name: /名称/ }).style.width).toBe('50%')
    expect(screen.getByRole('columnheader', { name: /记录数/ }).style.width).toBe('50%')
  })

  it('ignores a flex column when the header is hidden', () => {
    // Wrapping is a page-list contract; a sub-table inside an expanded row
    // stays content-sized even if one of its columns is marked flex.
    const columns = [
      textColumn<Zone>({ accessorKey: 'name', header: '名称', flex: true }),
      textColumn<Zone>({ accessorKey: 'records', header: '记录数' }),
    ]
    renderWithProviders(<DataTable columns={columns} data={ZONES} getRowId={(r) => r.id} hideHeader />)
    expect(screen.getByRole('table').className).toContain('min-w-max')
  })

  it('hugs every non-flex column so the deficit falls on the flex column', () => {
    // Without `min-w-max` a shrinking table distributes the deficit over every
    // wrappable column — one character per line for anything in `.font-data`,
    // which carries `word-break: break-all`. nowrap on the siblings keeps them
    // content-sized so only the flex column wraps.
    const columns = [
      textColumn<Zone>({ accessorKey: 'name', header: '名称', flex: true }),
      textColumn<Zone>({ accessorKey: 'records', header: '记录数' }),
    ]
    renderWithProviders(<DataTable columns={columns} data={ZONES} getRowId={(r) => r.id} />)
    expect(screen.getByRole('columnheader', { name: /记录数/ }).className).toContain('whitespace-nowrap')
    expect(screen.getByRole('columnheader', { name: /名称/ }).className).not.toContain('whitespace-nowrap')
    const [nameCell, recordsCell] = within(dataRows()[0]).getAllByRole('cell')
    expect(nameCell.className).not.toContain('whitespace-nowrap')
    expect(recordsCell.className).toContain('whitespace-nowrap')
  })

  it('leaves every column wrappable when no column is flex', () => {
    renderWithProviders(<DataTable columns={zoneColumns()} data={ZONES} getRowId={(r) => r.id} />)
    for (const head of screen.getAllByRole('columnheader')) {
      expect(head.className).not.toContain('whitespace-nowrap')
    }
    for (const cell of within(dataRows()[0]).getAllByRole('cell')) {
      expect(cell.className).not.toContain('whitespace-nowrap')
    }
  })
})

describe('DataTable — scrollable fill-and-centre', () => {
  // A `scrollable` table pins its card to the leftover viewport height, so the
  // zero-row states cannot live in a table cell (they would sit at the top of a
  // mostly-blank card). They move into a flex-1 region under the header and
  // centre vertically. These guard that branch against the static-table path.
  function tableContainer() {
    return screen.getByRole('table').closest('[data-slot="table-container"]') as HTMLElement
  }

  it('stretches the scroll container and keeps rows in the body when there is data', () => {
    renderWithProviders(<DataTable columns={zoneColumns()} data={ZONES} getRowId={(r) => r.id} scrollable />)
    expect(tableContainer().className).toContain('overflow-y-auto')
    expect(tableContainer().className).toContain('flex-1')
    expect(tableContainer().className).not.toContain('shrink-0')
    // Rows render normally inside the body.
    expect(screen.getByText('alpha.com').closest('tbody')).not.toBeNull()
  })

  it('moves the empty state out of the body into a centred region when scrollable', () => {
    renderWithProviders(<DataTable columns={zoneColumns()} data={[]} getRowId={(r) => r.id} scrollable />)
    const empty = screen.getByText('暂无数据')
    // Not inside a table cell any more…
    expect(empty.closest('tbody')).toBeNull()
    expect(empty.closest('[data-slot="table-container"]')).toBeNull()
    // …but still inside the card, and the header table collapses to `shrink-0`.
    expect(empty.closest('[data-slot="data-table"]')).not.toBeNull()
    expect(tableContainer().className).toContain('shrink-0')
  })

  it('moves the no-results state out of the body too when a filter is active', () => {
    renderWithProviders(
      <DataTable columns={zoneColumns()} data={ZONES} getRowId={(r) => r.id} globalFilter="zzz" scrollable />,
    )
    const noResults = screen.getByText('没有匹配的结果')
    expect(noResults.closest('tbody')).toBeNull()
  })

  it('renders the loading skeleton in the centred region when scrollable', () => {
    renderWithProviders(<DataTable columns={zoneColumns()} data={[]} getRowId={(r) => r.id} loading scrollable />)
    expect(screen.getByRole('status').closest('tbody')).toBeNull()
    expect(screen.getByRole('status').closest('[data-slot="table-container"]')).toBeNull()
  })

  it('keeps the empty state inside the body for a non-scrollable table', () => {
    // The static path is unchanged: the empty state stays in a full-width cell.
    renderWithProviders(<DataTable columns={zoneColumns()} data={[]} getRowId={(r) => r.id} />)
    expect(screen.getByText('暂无数据').closest('tbody')).not.toBeNull()
    expect(tableContainer().className).not.toContain('overflow-y-auto')
  })
})

describe('DataTable — page-size select display', () => {
  // Radix `SelectValue` renders the selected *item's* label. If the live page
  // size is not among the options there is no item to display and the trigger
  // collapses to a blank box — exactly what operators saw once every list
  // settled on the house size of 25 while the option list stopped at
  // 10/20/50/100. These pin the trigger to always show the current value.
  function pageSizeTrigger() {
    return screen.getByRole('combobox')
  }

  it('shows the house page size (25) in the trigger', () => {
    renderWithProviders(
      <DataTable
        columns={zoneColumns()}
        data={[ZONES[0]]}
        getRowId={(r) => r.id}
        server={{ page: 1, pageSize: 25, total: 1, totalPages: 1, onPageChange: vi.fn(), onPageSizeChange: vi.fn() }}
      />,
    )
    expect(pageSizeTrigger()).toHaveTextContent('25')
  })

  it('merges an unusual page size into the options so the trigger is never blank', () => {
    renderWithProviders(
      <DataTable
        columns={zoneColumns()}
        data={[ZONES[0]]}
        getRowId={(r) => r.id}
        server={{ page: 1, pageSize: 30, total: 1, totalPages: 1, onPageChange: vi.fn(), onPageSizeChange: vi.fn() }}
      />,
    )
    expect(pageSizeTrigger()).toHaveTextContent('30')
  })
})
