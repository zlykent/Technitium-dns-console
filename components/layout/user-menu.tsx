'use client'

import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { CircleUser, KeyRound, LogOut, ShieldCheck, UserCog } from 'lucide-react'
import * as React from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useSession } from '@/lib/auth/session'

/**
 * Account menu.
 *
 * Everything here routes into the `/account` page's tabs rather than opening
 * dialogs, so each self-service flow has a stable, linkable URL — important when
 * an operator is being talked through 2FA enrolment over a phone call.
 */
export function UserMenu() {
  const t = useTranslations('nav')
  const tc = useTranslations('common')
  const ta = useTranslations('account')
  const router = useRouter()
  const { session, signOut } = useSession()
  const [signingOut, setSigningOut] = React.useState(false)

  if (!session) {
    return (
      <Button variant="ghost" size="sm" onClick={() => router.push('/login')}>
        {tc('actions.open')}
      </Button>
    )
  }

  const go = (tab: string) => () => router.push(`/account?tab=${tab}`)

  const handleSignOut = async () => {
    setSigningOut(true)
    try {
      await signOut()
      toast.success(ta('logout.success'))
      router.replace('/login')
    } finally {
      setSigningOut(false)
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="h-8 gap-2 px-2" aria-label={session.displayName || session.username}>
          <span className="grid size-6 shrink-0 place-items-center rounded-full bg-primary/15 text-[10px] font-semibold text-primary">
            {initials(session.displayName || session.username)}
          </span>
          <span className="hidden max-w-28 truncate text-xs font-medium sm:block">{session.displayName || session.username}</span>
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="font-normal">
          <span className="block text-[11px] uppercase tracking-wide text-muted-foreground">{t('userMenu.signedInAs')}</span>
          <span className="block truncate text-sm font-medium">{session.displayName || session.username}</span>
          <span className="font-data block truncate text-xs text-muted-foreground">{session.username}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />

        <DropdownMenuItem onSelect={go('profile')}>
          <CircleUser className="size-4" aria-hidden />
          {t('userMenu.profile')}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={go('security')}>
          <KeyRound className="size-4" aria-hidden />
          {t('userMenu.changePassword')}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={go('security')}>
          <ShieldCheck className="size-4" aria-hidden />
          {t('userMenu.twoFactor')}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={go('tokens')}>
          <UserCog className="size-4" aria-hidden />
          {t('userMenu.apiTokens')}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={go('sessions')}>
          <CircleUser className="size-4" aria-hidden />
          {t('userMenu.mySessions')}
        </DropdownMenuItem>

        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onSelect={handleSignOut} disabled={signingOut}>
          <LogOut className="size-4" aria-hidden />
          {signingOut ? t('userMenu.signingOut') : t('userMenu.signOut')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function initials(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) return '?'
  const parts = trimmed.split(/[\s._-]+/).filter(Boolean)
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
  return trimmed.slice(0, 2).toUpperCase()
}
