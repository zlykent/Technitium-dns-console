'use client'

import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ChevronsLeft } from 'lucide-react'
import * as React from 'react'
import { BrandMark } from '@/components/app/brand-mark'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useSession } from '@/lib/auth/session'
import { createPersistentStore, usePersistentStore } from '@/lib/hooks/use-persistent-state'
import { visibleSections } from '@/lib/nav'
import { useServers } from '@/lib/servers/provider'
import { cn } from '@/lib/utils'

/**
 * Navigation rail.
 *
 * Collapses to an icon strip rather than disappearing: on a wall-mounted NOC
 * screen the labels are noise, but the affordances must stay reachable without
 * a hamburger. The collapsed state is persisted so a reload keeps the layout.
 *
 * Items are filtered by the session's permission map, which means a user with
 * only `Zones.canView` sees a rail with exactly one entry — the UI never offers
 * a link that would 403.
 */

const COLLAPSE_KEY = 'tdns.sidebar.collapsed'

const collapseStore = createPersistentStore<boolean>({
  key: COLLAPSE_KEY,
  parse: (raw) => raw === '1',
  serialize: (collapsed) => (collapsed ? '1' : '0'),
})

export interface SidebarProps {
  collapsed: boolean
  onToggleCollapse: () => void
  /** Renders a mobile "close" affordance when shown in a sheet. */
  variant?: 'desktop' | 'mobile'
  onNavigate?: () => void
}

export function Sidebar({ collapsed, onToggleCollapse, variant = 'desktop', onNavigate }: SidebarProps) {
  const t = useTranslations('nav')
  const tc = useTranslations('common')
  const pathname = usePathname()
  const { permissions, session } = useSession()
  const { active } = useServers()
  const sections = React.useMemo(() => visibleSections(permissions), [permissions])

  const rail = variant === 'desktop' && collapsed

  return (
    <div
      data-slot="sidebar"
      data-collapsed={rail || undefined}
      className={cn(
        'flex h-full flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground',
        rail ? 'w-14' : 'w-60',
        'transition-[width] duration-200 ease-out',
      )}
    >
      {/* brand */}
      <div className={cn('flex h-14 shrink-0 items-center gap-2.5 border-b border-sidebar-border', rail ? 'justify-center px-2' : 'px-4')}>
        <span className="relative grid size-8 shrink-0 place-items-center rounded-md bg-primary/15 text-primary">
          <BrandMark className="size-4.5" />
        </span>
        {!rail && (
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold tracking-tight text-foreground">{tc('appName')}</span>
            <span className="block truncate font-mono text-[11px] text-muted-foreground">{active?.url.replace(/^https?:\/\//, '') ?? tc('fields.unknown')}</span>
          </span>
        )}
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <nav aria-label={tc('a11y.mainNavigation')} className="flex flex-col gap-4 p-2">
          {sections.length === 0 && !rail && (
            <p className="px-2 py-6 text-center text-xs text-muted-foreground">{tc('table.empty')}</p>
          )}

          {sections.map((section) => (
            <div key={section.key} className="flex flex-col gap-0.5">
              {!rail && (
                <p className="px-2 pb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/80">
                  {t(`sections.${section.key}`)}
                </p>
              )}
              {rail && <Separator className="mx-2 mb-1 bg-sidebar-border" />}

              {section.items.map((item) => {
                const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`)
                const Icon = item.icon
                const label = t(`items.${item.key}.label`)

                const link = (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={onNavigate}
                    aria-current={isActive ? 'page' : undefined}
                    className={cn(
                      'group relative flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm font-medium transition-colors',
                      'focus-visible:ring-[3px] focus-visible:ring-sidebar-ring/50',
                      rail && 'justify-center px-0',
                      isActive
                        ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                        : 'text-sidebar-foreground/75 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground',
                    )}
                  >
                    {/* Signature accent: a 2px bar on the active item only. */}
                    {isActive && <span aria-hidden className="absolute inset-y-1.5 -left-2 w-0.5 rounded-full bg-sidebar-primary" />}
                    <Icon className={cn('size-4 shrink-0', isActive ? 'text-sidebar-primary' : 'text-muted-foreground group-hover:text-foreground')} aria-hidden />
                    {!rail && <span className="truncate">{label}</span>}
                  </Link>
                )

                if (!rail) return link
                return (
                  <Tooltip key={item.href}>
                    <TooltipTrigger asChild>{link}</TooltipTrigger>
                    <TooltipContent side="right">{label}</TooltipContent>
                  </Tooltip>
                )
              })}
            </div>
          ))}
        </nav>
      </ScrollArea>

      {/* footer: signed-in identity + collapse toggle */}
      <div className="shrink-0 border-t border-sidebar-border p-2">
        {session && (
          <div className={cn('flex items-center gap-2 rounded-md px-2 py-1.5', rail && 'justify-center px-0')}>
            <span className="grid size-7 shrink-0 place-items-center rounded-full bg-primary/15 text-[11px] font-semibold text-primary">
              {initials(session.displayName || session.username)}
            </span>
            {!rail && (
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-medium text-foreground">{session.displayName || session.username}</span>
                <span className="block truncate font-mono text-[11px] text-muted-foreground">{session.username}</span>
              </span>
            )}
            {!rail && session.info?.version && <Badge variant="muted" className="font-mono text-[10px]">v{session.info.version}</Badge>}
          </div>
        )}

        {variant === 'desktop' && (
          <Button
            variant="ghost"
            size={rail ? 'icon-sm' : 'sm'}
            onClick={onToggleCollapse}
            className={cn('mt-1 w-full text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-foreground', rail && 'justify-center')}
            aria-label={tc('a11y.toggleSidebar')}
            title={tc('a11y.toggleSidebar')}
          >
            <ChevronsLeft className={cn('size-4 transition-transform duration-200', rail && 'rotate-180')} aria-hidden />
            {!rail && <span className="text-xs">{tc('a11y.toggleSidebar')}</span>}
          </Button>
        )}
      </div>
    </div>
  )
}

function initials(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) return '?'
  const parts = trimmed.split(/[\s._-]+/).filter(Boolean)
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
  return trimmed.slice(0, 2).toUpperCase()
}

export function useSidebarCollapsed(): [boolean, () => void] {
  const [collapsed, setCollapsed] = usePersistentStore(collapseStore)
  const toggle = React.useCallback(() => setCollapsed((prev) => !prev), [setCollapsed])
  return [collapsed, toggle]
}
