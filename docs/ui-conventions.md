# UI conventions

Rules every component and page in this repository follows. Read this before
adding a component.

## Stack

- Next.js 16 App Router, React 19, TypeScript 5.9 `strict`.
- Tailwind CSS v4 (CSS-first). **There is no `tailwind.config.ts`** — tokens live
  in `app/globals.css` under `@theme inline`. Never add a config file.
- Radix UI primitives + `class-variance-authority`, composed through `cn()`.
  `cn` comes from the [`cn`](https://www.npmjs.com/package/cn) package
  (shadcn-ui's compiled drop-in replacement for `clsx` + `tailwind-merge`),
  re-exported from `lib/utils.ts` — never import it from `cn` directly. It
  flattens falsy/array/object inputs and lets a later class win over an
  earlier one in the same Tailwind group (`cn('h-9', 'h-8')` → `h-8`).
  Note: unlike clsx, it drops numeric inputs — stringify before passing.
- TanStack Query v5 for all server state, TanStack Table v8 for tables.
- `next-intl` for copy. **No hard-coded user-facing strings** — always
  `useTranslations('<namespace>')` (client) or `getTranslations` (server).
- `lucide-react` **v1.45** for icons. Names changed from v0: use `Trash`,
  `Ellipsis`, `EllipsisVertical`, `LockOpen`, `ListFilter`, `FingerprintPattern`,
  `CirclePlus`, `CircleMinus`, `CircleStop`, `ShieldQuestionMark`, `CircleX`,
  `LoaderCircle`. Verify with `node scripts/check-icons.mjs`.
- `sonner` for toasts, `recharts` for charts, `date-fns` v4 for time.

## File layout

```
components/ui/        shadcn-style primitives, one component per file
components/app/       cross-page building blocks (data table, page shell, …)
components/layout/    sidebar, topbar, switchers — chrome only
components/charts/    recharts wrappers
app/(console)/…       authenticated pages
app/(auth)/login      unauthenticated
lib/api/              proxy client + typed SDK (never import into layout chrome)
lib/format/           pure presentation formatters, locale passed explicitly
lib/hooks/            client hooks
```

Import alias is `@/` → repository root. Always use it, never relative `../../`.

## Component authoring

1. Add `'use client'` only when the file uses hooks, event handlers, Radix, or
   browser APIs. Pure presentational components stay server-compatible.
2. Use the **function declaration + named export** style (no default exports):

   ```tsx
   function Card({ className, ...props }: React.ComponentProps<'div'>) { … }
   export { Card, cardVariants }
   ```

3. Spread props with `React.ComponentProps<'element'>`, accept `className` and
   merge with `cn(...)`. Add `data-slot="<name>"` to the root for test hooks.
4. Forward refs implicitly via `React.ComponentProps` (React 19 passes `ref` as a
   normal prop). Do **not** use `React.forwardRef`.
5. Variants via `cva`, exported alongside the component as `<name>Variants`.
6. Accessibility is not optional: Radix supplies most of it, but custom
   components need `aria-*`, `role`, visible `focus-visible` rings and keyboard
   support. Icon-only buttons require `aria-label` or an `sr-only` label.

## Design tokens (from `app/globals.css`)

Colours: `background`, `foreground`, `card`, `popover`, `primary`, `secondary`,
`muted`, `accent`, `destructive`, `success`, `warning`, `info`, `border`,
`input`, `ring`, the full `sidebar-*` set, and `chart-1…chart-6`.
Each has a matching `-foreground` where it is meant to hold text.

Radii: `rounded-sm|md|lg|xl` (base `--radius: 0.625rem`).
Shadows: `shadow-card`, `shadow-raised`.
Utility classes: `.surface` (hairline border + inset highlight), `.surface-raised`,
`.status-dot`, `.font-data` (monospace + break-all, for DNS names, IPs, rData,
digests, tokens — **always** use it for those).

Never hard-code a hex/rgb colour or an arbitrary `[#…]` value. If a token is
missing, add it to `app/globals.css` in both `:root` and `.dark`.

Density is deliberate: this is an ops console. Default control height `h-9`
(`h-8` for `size="sm"`), table rows `py-2`, card padding `p-4`/`p-5`, gap `gap-3`.

## Copy & i18n

- Namespaces: `common`, `nav`, `auth`, `errors`, `dashboard`, `zones`, `records`,
  `dnssec`, `filtering`, `logs`, `dhcp`, `apps`, `dnsClient`, `settings`,
  `admin`, `account`. Files are `messages/<locale>/<namespace>.json`.
- `zh` and `en` must have identical key trees — enforced by
  `node scripts/check-i18n.mjs` (part of `pnpm verify`).
- Keys are camelCase, grouped by concern (`actions.save`, `table.empty`,
  `cards.totalQueries.label`). Add a key to **both** locales in the same change.
- Interpolation uses ICU braces: `t('table.showing', { from, to, total })`.
- Never concatenate translated fragments to build a sentence.

## Data & errors

- All upstream calls go through `lib/api/domains/*`, which wrap
  `apiRequest` / `apiDownload` from `lib/api/client`. Never call `fetch` to
  `/api/dns/...` directly from a component.
- Wrap calls in `useQuery` / `useMutation`. On mutation success: `toast.success`
  plus `queryClient.invalidateQueries` for the affected domain keys.
- Failures arrive as `DnsApiError`; use `describeError()` and map `code` to copy
  from the `errors` namespace. `isAuthError()` must redirect to `/login`.
- Destructive actions (delete, flush, uninstall, revoke, restore) always go
  through a confirm dialog — never a bare click.
- Loading states use `Skeleton`, not spinners, for content areas; `Button
  loading` for actions. Empty states use `<EmptyState>` with an icon, a title, a
  one-line body and a primary action where one exists.

## Verification gates

`pnpm verify` runs: `i18n:check` → `typecheck` → `lint` → `test` → `build`.
All five must pass before a change is considered done.
