'use client'

import { useTranslations } from 'next-intl'
import { usePathname } from 'next/navigation'
import { Menu } from 'lucide-react'
import * as React from 'react'
import { LocaleToggle } from '@/components/layout/locale-toggle'
import { ServerSwitcher } from '@/components/layout/server-switcher'
import { ThemeToggle } from '@/components/layout/theme-toggle'
import { UserMenu } from '@/components/layout/user-menu'
import { Sidebar } from '@/components/layout/sidebar'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { activeNavItem } from '@/lib/nav'
import { cn } from '@/lib/utils'

/**
 * Top bar.
 *
 * Deliberately thin (h-14, matching the sidebar brand row) so a data table gets
 * the vertical space. It carries three things and nothing else: the current
 * module name, the server switcher, and the account cluster. On narrow screens
 * the switcher collapses into the sheet next to the navigation.
 */

export function Topbar({ className }: { className?: string }) {
  const t = useTranslations('nav')
  const tc = useTranslations('common')
  const pathname = usePathname()
  const [mobileOpen, setMobileOpen] = React.useState(false)

  const item = activeNavItem(pathname)
  const title = item ? t(`items.${item.key}.label`) : tc('appName')

  // Close the sheet once navigation lands. Done during render rather than in an
  // effect: the old pathname is information from a previous render, and React's
  // documented pattern for that is to reconcile it here so the sheet is already
  // shut in the same paint instead of one frame later.
  const [sheetPathname, setSheetPathname] = React.useState(pathname)
  if (sheetPathname !== pathname) {
    setSheetPathname(pathname)
    if (mobileOpen) setMobileOpen(false)
  }

  return (
    <header
      data-slot="topbar"
      className={cn(
        'sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b border-border/60 bg-background/85 px-3 backdrop-blur supports-[backdrop-filter]:bg-background/70 sm:px-4',
        className,
      )}
    >
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetTrigger asChild>
          <Button variant="ghost" size="icon-sm" className="lg:hidden" aria-label={tc('a11y.openMenu')}>
            <Menu className="size-4" aria-hidden />
          </Button>
        </SheetTrigger>
        <SheetContent side="left" className="w-64 p-0 sm:max-w-64">
          <SheetTitle className="sr-only">{tc('a11y.mainNavigation')}</SheetTitle>
          <Sidebar collapsed={false} onToggleCollapse={() => setMobileOpen(false)} variant="mobile" onNavigate={() => setMobileOpen(false)} />
        </SheetContent>
      </Sheet>

      <h2 className="min-w-0 truncate text-sm font-semibold tracking-tight">{title}</h2>

      <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
        <ServerSwitcher className="hidden max-w-48 md:flex lg:max-w-64" />
        <span className="mx-0.5 hidden h-5 w-px bg-border sm:block" aria-hidden />
        <LocaleToggle />
        <ThemeToggle />
        <UserMenu />
      </div>
    </header>
  )
}
