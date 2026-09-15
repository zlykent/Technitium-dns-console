'use client'

import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { cn } from '@/lib/utils'

/**
 * Records / DNSSEC / Options / Permissions navigation for one zone.
 *
 * Every zone sub-page is a tab of the same surface, so the bar lives here once
 * instead of being copied per view — `current` marks the active entry. The
 * breadcrumb above it always leads back to the zone list, on all four tabs.
 */

export type ZoneTabId = 'records' | 'dnssec' | 'options' | 'permissions'

export interface ZoneTabsProps {
  zone: string
  current: ZoneTabId
}

export function ZoneTabs({ zone, current }: ZoneTabsProps) {
  const tz = useTranslations('zones')
  const base = `/zones/${encodeURIComponent(zone)}`
  const tabs: { id: ZoneTabId; href: string; label: string }[] = [
    { id: 'records', href: base, label: tz('detail.tabs.records') },
    { id: 'dnssec', href: `${base}/dnssec`, label: tz('detail.tabs.dnssec') },
    { id: 'options', href: `${base}/options`, label: tz('detail.tabs.options') },
    { id: 'permissions', href: `${base}/permissions`, label: tz('detail.tabs.permissions') },
  ]
  return (
    <nav aria-label={tz('title')} className="flex flex-wrap items-center gap-1 border-b border-border">
      {tabs.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          aria-current={tab.id === current ? 'page' : undefined}
          className={cn(
            '-mb-px rounded-t-md px-3 py-2 text-sm transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50',
            tab.id === current
              ? 'border-b-2 border-primary font-medium text-foreground'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  )
}
