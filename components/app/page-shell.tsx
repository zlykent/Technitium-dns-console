'use client'

import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import * as React from 'react'
import { cn } from '@/lib/utils'

/**
 * Page furniture.
 *
 * Every console page has the same anatomy: an optional breadcrumb, an optional
 * title with a one-line description, a right-aligned action cluster, then the
 * content. Centralising it keeps the vertical rhythm identical across the
 * eleven modules and gives screen readers a predictable `<h1>` + region
 * structure.
 *
 * The title is optional on purpose: the topbar already names the current
 * module, so top-level pages pass only `actions` and avoid painting the same
 * words twice. Sub-pages (zone records, DNSSEC, …) still pass a title because
 * theirs carries information the topbar does not — the zone name.
 */

export interface Breadcrumb {
  label: string
  href?: string
}

export interface PageHeaderProps {
  /** Omit on top-level modules — the topbar label already says where you are. */
  title?: React.ReactNode
  description?: React.ReactNode
  breadcrumbs?: Breadcrumb[]
  /** Buttons and controls shown at the trailing edge of the header. */
  actions?: React.ReactNode
  /** Rendered under the actions row, spanning the full width. */
  footer?: React.ReactNode
  className?: string
}

export function PageHeader({ title, description, breadcrumbs, actions, footer, className }: PageHeaderProps) {
  const hasHeading = Boolean(title) || Boolean(description)
  return (
    <header data-slot="page-header" className={cn('flex flex-col gap-3', className)}>
      {breadcrumbs && breadcrumbs.length > 0 && <Breadcrumbs items={breadcrumbs} />}

      {(hasHeading || actions) && (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          {hasHeading && (
            <div className="min-w-0 flex-1">
              {title && <h1 className="text-xl font-semibold tracking-tight text-balance sm:text-2xl">{title}</h1>}
              {description && <p className="mt-1 text-sm text-muted-foreground text-pretty">{description}</p>}
            </div>
          )}
          {actions && <div className="ml-auto flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
        </div>
      )}

      {footer}
    </header>
  )
}

export function Breadcrumbs({ items, className }: { items: Breadcrumb[]; className?: string }) {
  return (
    <nav aria-label="breadcrumb" className={cn('min-w-0', className)}>
      <ol className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
        {items.map((item, index) => {
          const last = index === items.length - 1
          return (
            <li key={`${item.label}-${index}`} className="flex min-w-0 items-center gap-1">
              {index > 0 && <ChevronRight className="size-3 shrink-0 text-muted-foreground/50" aria-hidden />}
              {item.href && !last ? (
                <Link href={item.href} className="truncate rounded-sm hover:text-foreground hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50">
                  {item.label}
                </Link>
              ) : (
                <span className="truncate font-medium text-foreground" aria-current={last ? 'page' : undefined}>
                  {item.label}
                </span>
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}

export interface PageShellProps {
  children: React.ReactNode
  /** Extra spacing below the header before content starts. */
  gap?: 'sm' | 'md' | 'lg'
  className?: string
}

/**
 * Scrollable content region of a console page. The sidebar is `h-dvh` fixed, so
 * this is the element that actually scrolls — keeping the header sticky inside
 * it is what makes long tables usable.
 */
export function PageShell({ children, gap = 'md', className }: PageShellProps) {
  return (
    <div
      data-slot="page-shell"
      className={cn(
        'flex min-w-0 flex-1 flex-col gap-6 p-4 sm:p-6',
        gap === 'sm' && 'gap-4',
        gap === 'lg' && 'gap-8',
        className,
      )}
    >
      {children}
    </div>
  )
}

/** A titled card-ish region used to group related controls on dense pages. */
export function Section({
  title,
  description,
  actions,
  children,
  className,
  contentClassName,
}: {
  title?: React.ReactNode
  description?: React.ReactNode
  actions?: React.ReactNode
  children: React.ReactNode
  className?: string
  contentClassName?: string
}) {
  return (
    <section data-slot="section" className={cn('surface rounded-lg', className)}>
      {(title || actions) && (
        <div className="flex items-start justify-between gap-3 border-b border-border/60 px-4 py-3">
          <div className="min-w-0">
            {title && <h2 className="text-sm font-semibold tracking-tight">{title}</h2>}
            {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </div>
      )}
      <div className={cn('p-4', contentClassName)}>{children}</div>
    </section>
  )
}

/** Two-column definition list for read-only detail panels. */
export function DefinitionList({ items, className }: { items: { label: React.ReactNode; value: React.ReactNode }[]; className?: string }) {
  return (
    <dl data-slot="definition-list" className={cn('grid gap-x-6 gap-y-3 sm:grid-cols-2', className)}>
      {items.map((item, index) => (
        <div key={index} className="min-w-0">
          <dt className="text-xs text-muted-foreground">{item.label}</dt>
          <dd className="mt-0.5 break-words text-sm">{item.value}</dd>
        </div>
      ))}
    </dl>
  )
}
