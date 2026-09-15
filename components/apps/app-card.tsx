'use client'

import { useTranslations } from 'next-intl'
import { CircleCheck, Download, HardDrive, Package, RefreshCw, Tag } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { StoreApp } from '@/lib/api/types/apps'
import { cn } from '@/lib/utils'

/**
 * One tile of the app-store grid.
 *
 * This is a storefront, not a table row, so the card leans on elevation and a
 * status badge rather than columns: `surface` + a hover lift (`-translate-y-0.5`
 * + `shadow-raised`) + a `primary/10` icon well. Every colour is a semantic
 * token — no hex, no `[#…]`.
 *
 * Two data quirks drive the props:
 *
 *  - `StoreApp.size` is a **pre-formatted string** (`"61.54 KB"`, see
 *    `lib/api/types/apps.ts:29`), so it is rendered verbatim — `formatBytes`
 *    takes a number and would be wrong here.
 *  - `StoreApp` carries no `installedVersion`/`updateAvailable`, so "is there a
 *    newer version?" cannot be answered from the store payload alone. The panel
 *    joins each store app against `apps/list` by name and passes the result in
 *    as `updateAvailable`; the card just renders the three states (install /
 *    update / installed).
 *
 * `anyBusy` disables every *other* card's action while one download is in
 * flight: `downloadAndInstall` makes the DNS server fetch the package, which can
 * take tens of seconds, and two concurrent server-side downloads are asking for
 * trouble on a single-threaded admin API.
 */

export interface AppCardProps {
  app: StoreApp
  /** True when the joined installed app reports a newer version. */
  updateAvailable: boolean
  canModify: boolean
  installing: boolean
  updating: boolean
  /** Some other card's mutation is in flight. */
  anyBusy: boolean
  onInstall: () => void
  onUpdate: () => void
}

export function AppCard({ app, updateAvailable, canModify, installing, updating, anyBusy, onInstall, onUpdate }: AppCardProps) {
  const t = useTranslations('apps')
  const installed = app.installed
  const idle = !installing && !updating
  const disabled = anyBusy && idle

  return (
    <article
      data-slot="app-card"
      className={cn(
        'surface flex flex-col gap-3 rounded-lg p-4 transition-all duration-200',
        'hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-raised',
      )}
    >
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-md bg-primary/10 text-primary" aria-hidden>
          <Package className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-semibold tracking-tight" title={app.name}>
            {app.name}
          </h3>
          {installed && (
            <div className="mt-1.5 flex items-center gap-1.5">
              <span className="sr-only">{t('store.columns.status')}: </span>
              {updateAvailable ? (
                <Badge variant="warning">
                  <RefreshCw aria-hidden />
                  {t('store.update')}
                </Badge>
              ) : (
                <Badge variant="success">
                  <CircleCheck aria-hidden />
                  {t('store.installed')}
                </Badge>
              )}
            </div>
          )}
        </div>
      </div>

      <p className="line-clamp-3 text-xs leading-relaxed text-muted-foreground text-pretty">
        <span className="sr-only">{t('store.columns.description')}: </span>
        {app.description}
      </p>

      <dl className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <div className="flex items-center gap-1">
          <Tag className="size-3 shrink-0" aria-hidden />
          <dt className="sr-only">{t('store.columns.version')}</dt>
          <dd className="font-data">{app.version}</dd>
        </div>
        <div className="flex items-center gap-1">
          <HardDrive className="size-3 shrink-0" aria-hidden />
          <dt className="sr-only">{t('store.columns.size')}</dt>
          <dd className="font-data">{app.size}</dd>
        </div>
      </dl>

      <div className="mt-auto flex items-center gap-2 border-t border-border/60 pt-3" role="group" aria-label={t('store.columns.actions')}>
        {!canModify ? (
          <span className="w-full text-center text-xs text-muted-foreground">
            {installed ? t('store.installed') : t('store.columns.version')} {app.version}
          </span>
        ) : installed ? (
          updateAvailable ? (
            <Button size="sm" variant="outline" className="w-full" onClick={onUpdate} loading={updating} disabled={disabled}>
              {idle && <RefreshCw className="size-3.5" aria-hidden />}
              {updating ? t('store.updating') : t('store.update')}
            </Button>
          ) : (
            <Button size="sm" variant="outline" className="w-full" disabled>
              <CircleCheck className="size-3.5" aria-hidden />
              {t('store.installed')}
            </Button>
          )
        ) : (
          <Button size="sm" className="w-full" onClick={onInstall} loading={installing} disabled={disabled}>
            {idle && <Download className="size-3.5" aria-hidden />}
            {installing ? t('store.installing') : t('store.install')}
          </Button>
        )}
      </div>
    </article>
  )
}
