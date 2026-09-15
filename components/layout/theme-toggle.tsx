'use client'

import { useTranslations } from 'next-intl'
import { useTheme } from 'next-themes'
import { Monitor, Moon, Sun } from 'lucide-react'
import * as React from 'react'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { useMounted } from '@/lib/hooks/use-mounted'

/**
 * Theme switcher.
 *
 * The icon is resolved only after mount: `next-themes` cannot know the applied
 * theme during SSR, and rendering a guessed icon produces a hydration mismatch
 * plus a visible flicker.
 */
export function ThemeToggle() {
  const t = useTranslations('common')
  const { theme, setTheme } = useTheme()
  const mounted = useMounted()

  const Icon = !mounted ? Sun : theme === 'dark' ? Moon : theme === 'light' ? Sun : Monitor

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={t('theme.label')} title={t('theme.label')}>
          <Icon className="size-4" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-36">
        <DropdownMenuItem onClick={() => setTheme('light')}>
          <Sun className="size-4" aria-hidden />
          {t('theme.light')}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme('dark')}>
          <Moon className="size-4" aria-hidden />
          {t('theme.dark')}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme('system')}>
          <Monitor className="size-4" aria-hidden />
          {t('theme.system')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
