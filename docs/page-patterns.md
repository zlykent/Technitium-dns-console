# Page implementation patterns

Contract for every route under `app/(console)/`. Read this before writing a page;
`components/dashboard/dashboard-view.tsx` is the canonical worked example and
`docs/ui-conventions.md` holds the component-level rules.

## File layout

```
app/(console)/<route>/page.tsx        Server Component, mounts the client view only
components/<module>/<view>.tsx        'use client' — the whole page
components/<module>/<dialog>.tsx      one file per non-trivial dialog/form
```

`page.tsx` stays a shim (see `app/(console)/dashboard/page.tsx`): no data
fetching, no session reads. Everything that needs the session lives in the client
view, because the session and the selected server both exist only in the
browser.

## Data flow

```tsx
const t = useTranslations('<namespace>')     // the module's own namespace
const tc = useTranslations('common')         // actions/fields/table/dialog/toast/status
const locale = useLocaleCode()               // pass to every lib/format helper
const target = useTargetKey()                // first element of every query key
const queryClient = useQueryClient()
const can = useCan('<Section>')              // { canView, canModify, canDelete }
```

- **Reads** go through `useQuery` with a key from `lib/api/query-keys.ts`. Never
  invent a key shape; if the key you need is missing, add it there.
- **Writes** go through `useMutation`, and on success must
  `queryClient.invalidateQueries({ queryKey: queryKeys.domain(target, '<domain>') })`
  plus a `toast.success(tc('toast.created' | 'toast.saved' | 'toast.deleted'))`.
- Errors surface as `toast.error(describeError(err).message)` for mutations, and
  as `<ErrorState error={…} onRetry={…} />` for queries. Never swallow.
- `onError: (error) => toast.error(...)` — `describeError` from
  `@/lib/api/client` turns a `DnsApiError` into `{ code, message, isAuth }`.

## Layout

```tsx
<PageShell>
  <PageHeader actions={<>…</>} />
  …content…
</PageShell>
```

- `PageShell` already provides the padding and vertical rhythm; do not add an
  outer `<div className="p-6">`.
- Top-level modules pass **only `actions`** to `PageHeader`: the topbar already
  prints the module label, so a page-level `title`/`description` would say the
  same words twice. Sub-pages (zone records, DNSSEC, options, permissions) are
  the exception — their title is the zone name plus breadcrumbs, information
  the topbar does not carry.
- Group related blocks in `<Section title=… description=… actions=…>`.
- Grids: `grid grid-cols-1 gap-3 lg:grid-cols-2` (or `xl:grid-cols-3`).
- Tables: `<DataTable>` — never a hand-rolled `<table>`.

## Tables

`DataTable` supports both modes; pick deliberately:

- **Server-paginated** (`zones/list`, `logs/query`, `admin/sessions/list`): pass
  `server={{ page, pageSize, total, totalPages, onPageChange, onPageSizeChange }}`
  and keep `globalFilter` off (the upstream does the filtering).
- **Client-side**: pass `clientPagination={{ pageSize: 25 }}` and
  `globalFilterColumns={['name', 'type']}`.

Columns are built with `textColumn({ header, cell, align, width, meta })` or a
plain `ColumnDef`. Cell values that are DNS data (names, addresses, digests,
TTLs, tokens) must render inside `.font-data`.

Row actions go in a `DropdownMenu` triggered by `<Button variant="ghost" size="icon-xs">`
with `<EllipsisVertical className="size-4" />`. Destructive entries get
`className="text-destructive focus:text-destructive"` and must open a
`ConfirmDialog` — never fire on click.

## Permissions

Gate on the flags, do not hide silently:

```tsx
{can.canModify && <Button …>{tc('actions.save')}</Button>}
```

A user who can view but not modify must still see the data with the controls
absent. `useCan('<Section>')` sections are the Technitium names: `Dashboard`,
`Zones`, `Cache`, `Allowed`, `Blocked`, `Logs`, `DhcpServer`, `Apps`, `Settings`,
`Administration`, `DnsClient`.

## i18n

- Namespaces are fixed at 16 (see `lib/i18n/messages.ts`). `common` holds
  `actions`, `fields`, `table`, `dialog`, `toast`, `status`, `time`, `units`,
  `form`, `a11y`, `pagination`, `theme`, `language` as **sub-keys**.
- Every visible string comes from the bundle. No literals in JSX, including
  `aria-label`, `title`, placeholders and confirm text.
- `messages/zh/*.json` and `messages/en/*.json` are already fully populated for
  every module — **the message file is the spec**. Read it first and build the
  page so every key is used; if a key you need is genuinely missing, add it to
  both locales and keep `pnpm i18n:check` green.
- ICU plurals/interpolation: `t('table.showing', { from, to, total })`.

## Forms

`react-hook-form` + `zod` for anything with more than three fields; plain
controlled state for one- or two-field dialogs. Use `Field` / `FieldLabel` /
`FieldDescription` / `FieldError` (or the `Form*` wrappers) so label binding and
error text stay consistent.

Submit buttons carry `loading={mutation.isPending}` and `disabled` while invalid.
Dialogs close only on success — on error, keep them open and render
`<ErrorState error={…} compact />` inside, so the operator does not lose what
they typed.

## Loading and empty

- First paint of a data region: `Skeleton` / `LoadingState` / `ChartSkeleton`.
  Never a bare spinner for content.
- No rows: `<EmptyState title=… body=… action=… icon=… />`.
- Rows existed but the filter matched none: `DataTable`'s `noResults` handles it.
- Inline async work (a row action): `InlineLoading` or the button's `loading`.

## Navigation

Zone-scoped routes live under `/zones/[zone]`:

| Path | Purpose |
| --- | --- |
| `/zones` | list + create/import/export/clone/convert |
| `/zones/[zone]` | records for the zone (t11) |
| `/zones/[zone]/options` | zone options |
| `/zones/[zone]/permissions` | zone ACL |
| `/zones/[zone]/dnssec` | DNSSEC (t12) |

`lib/nav.ts` matches by longest prefix, so all of them highlight **Zones** and
are guarded by `Zones.canView` automatically. Zone names contain dots, which are
legal in a path segment; always `decodeURIComponent` the param and
`encodeURIComponent` when building links.

## Verification

Before declaring a page done:

```
npx tsc --noEmit          # must be 0 errors
pnpm lint                 # must be clean
pnpm i18n:check           # zh/en key parity + no missing namespace
node scripts/check-icons.mjs   # lucide v1.45 renamed icons
```

Then drive it in the browser against the real server
(`http://127.0.0.1:5380`, `admin/123456`) — a page that compiles but renders
an error card is not done.
