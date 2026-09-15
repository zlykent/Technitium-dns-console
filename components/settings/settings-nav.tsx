'use client'

import { useTranslations } from 'next-intl'
import {
  Archive,
  Ban,
  Database,
  FolderTree,
  Gauge,
  Globe,
  KeyRound,
  Lock,
  MapPin,
  Network,
  RefreshCw,
  RotateCcw,
  Route,
  ScrollText,
  Share2,
  SlidersHorizontal,
  Wrench,
} from 'lucide-react'
import * as React from 'react'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { SECTION_IDS, type SectionId } from '@/components/settings/settings-fields'

/**
 * Sticky section navigation for the settings page, with scroll-spy.
 *
 * Sixteen panels and ~130 controls would be an unnavigable wall without this,
 * so the nav doubles as the page's table of contents. Two details worth knowing:
 *
 *  - **The observer watches `<main>`, implicitly.** `console-shell.tsx` makes
 *    `<main>` the scrolling element, but an `IntersectionObserver` with the
 *    default `root: null` still works: the spec clips the intersection rect by
 *    every scrollable ancestor, so "intersecting the viewport" already means
 *    "visible inside `<main>`". Passing `root` explicitly would require a ref
 *    threaded up through the layout, for no behavioural gain.
 *  - **Re-observing on filter changes.** Searching unmounts whole panels, and
 *    an observer holding a detached node never fires again. The effect depends
 *    on the *visible* id list, so it re-queries the DOM and re-attaches.
 */

type SectionIcon = React.ComponentType<{ className?: string }>

/** `sections.<id>` -> icon. Kept next to the nav because nothing else needs it. */
const SECTION_ICONS: Record<SectionId, SectionIcon> = {
  general: SlidersHorizontal,
  listeners: Network,
  zoneDefaults: FolderTree,
  webService: Globe,
  dnsOverX: Lock,
  recursion: Route,
  proxy: Share2,
  blocking: Ban,
  cache: Database,
  rateLimit: Gauge,
  edns: MapPin,
  logging: ScrollText,
  tsig: KeyRound,
  updates: RefreshCw,
  backup: Archive,
  advanced: Wrench,
}

/** DOM id of a panel — must match `SettingsSection`. */
export function sectionAnchorId(id: SectionId): string {
  return `settings-${id}`
}

/**
 * Scroll-spy over the mounted panels.
 *
 * The root margin collapses the viewport into a thin band just under the sticky
 * save bar (96px) ending at 20% height. The top-most panel touching that band is
 * "current", which reads naturally: the heading you just scrolled past. When no
 * panel touches it — possible in the gap between two cards — the previous value
 * is kept rather than flickering to nothing.
 */
export function useActiveSection(ids: readonly SectionId[]): SectionId {
  const [active, setActive] = React.useState<SectionId>(ids[0] ?? SECTION_IDS[0])
  const joined = ids.join('|')

  React.useEffect(() => {
    const nodes: HTMLElement[] = []
    for (const id of joined.split('|')) {
      const node = document.getElementById(sectionAnchorId(id as SectionId))
      if (node) nodes.push(node)
    }
    if (nodes.length === 0) return

    const intersecting = new Set<string>()
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = (entry.target as HTMLElement).dataset.settingsSection
          if (!id) continue
          if (entry.isIntersecting) intersecting.add(id)
          else intersecting.delete(id)
        }
        // DOM order wins over insertion order: `nodes` is built from `ids`,
        // which is already in page order.
        for (const node of nodes) {
          const id = node.dataset.settingsSection
          if (id && intersecting.has(id)) {
            setActive(id as SectionId)
            return
          }
        }
      },
      { rootMargin: '-96px 0px -80% 0px', threshold: 0 },
    )

    for (const node of nodes) observer.observe(node)
    return () => observer.disconnect()
  }, [joined])

  return active
}

/** Smooth-scroll a panel under the sticky save bar. */
export function scrollToSection(id: SectionId) {
  document.getElementById(sectionAnchorId(id))?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

export interface SettingsNavProps {
  /** Panels actually rendered — search hides the rest, and so must the nav. */
  ids: readonly SectionId[]
  active: SectionId
  onNavigate: (id: SectionId) => void
  /** Panels holding unsaved edits, marked so nothing gets lost off-screen. */
  dirty: ReadonlySet<SectionId>
  className?: string
}

export function SettingsNav({ ids, active, onNavigate, dirty, className }: SettingsNavProps) {
  const t = useTranslations('settings')

  return (
    <div className={cn('flex flex-col gap-3 lg:sticky lg:top-24 lg:self-start', className)}>
      <nav
        aria-label={t('title')}
        className="surface max-lg:overflow-x-auto lg:rounded-lg lg:p-2"
      >
        <ul className="flex gap-1 lg:flex-col">
          {ids.map((id) => {
            const Icon = SECTION_ICONS[id]
            const isActive = id === active
            const isDirty = dirty.has(id)
            return (
              <li key={id} className="shrink-0 lg:shrink">
                <button
                  type="button"
                  onClick={() => onNavigate(id)}
                  aria-current={isActive ? 'true' : undefined}
                  className={cn(
                    'flex w-full cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-xs transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
                    isActive ? 'bg-primary/12 font-medium text-primary' : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                  )}
                >
                  <Icon className="size-3.5 shrink-0" aria-hidden />
                  <span className="min-w-0 flex-1 truncate lg:whitespace-normal">{t(`sections.${id}`)}</span>
                  {isDirty && <span className="status-dot shrink-0 bg-warning" aria-hidden />}
                </button>
              </li>
            )
          })}
        </ul>
      </nav>

      <div className="surface hidden flex-col gap-2 rounded-lg p-3 text-xs text-muted-foreground lg:flex">
        <p className="flex items-start gap-1.5">
          <Badge variant="warning" className="mt-px shrink-0 px-1.5 py-0 text-[10px]">
            <RotateCcw className="size-2.5" aria-hidden />
          </Badge>
          <span>{t('restartHint')}</span>
        </p>
        <p>{t('dangerHint')}</p>
      </div>
    </div>
  )
}
