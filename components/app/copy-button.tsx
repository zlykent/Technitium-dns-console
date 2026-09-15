'use client'

import { useTranslations } from 'next-intl'
import { Check, Copy } from 'lucide-react'
import { toast } from 'sonner'
import * as React from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/**
 * Copy-to-clipboard.
 *
 * DNS data is copy-paste heavy: an operator reads a DS digest here and pastes it
 * into a registrar's control panel. `navigator.clipboard` is undefined outside a
 * secure context, and a LAN console served over plain HTTP is *not* one — so the
 * fallback path through a hidden textarea is required, not defensive decoration.
 */

export async function copyText(value: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(value)
      return true
    }
  } catch {
    // fall through to the legacy path
  }
  try {
    const area = document.createElement('textarea')
    area.value = value
    area.setAttribute('readonly', '')
    area.style.position = 'fixed'
    area.style.top = '-1000px'
    area.style.opacity = '0'
    document.body.appendChild(area)
    area.select()
    const ok = document.execCommand('copy')
    area.remove()
    return ok
  } catch {
    return false
  }
}

export interface CopyButtonProps {
  value: string
  /** Toast text; omit to copy silently. */
  label?: string
  size?: 'xs' | 'icon-xs' | 'sm' | 'icon-sm'
  variant?: 'ghost' | 'outline'
  className?: string
  disabled?: boolean
}

export function CopyButton({ value, label, size = 'icon-xs', variant = 'ghost', className, disabled }: CopyButtonProps) {
  const tc = useTranslations('common')
  const [copied, setCopied] = React.useState(false)
  const timer = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  React.useEffect(() => () => clearTimeout(timer.current), [])

  const onClick = async (event: React.MouseEvent) => {
    event.stopPropagation()
    const ok = await copyText(value)
    if (!ok) {
      toast.error(tc('toast.failed'))
      return
    }
    setCopied(true)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setCopied(false), 1500)
    if (label) toast.success(label)
  }

  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      onClick={(event) => void onClick(event)}
      disabled={disabled || !value}
      className={cn('shrink-0', copied && 'text-success hover:text-success', className)}
      aria-label={copied ? tc('actions.copied') : tc('actions.copy')}
      title={copied ? tc('actions.copied') : tc('actions.copy')}
    >
      {copied ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
    </Button>
  )
}

/**
 * Monospace value with a trailing copy affordance — the standard way this
 * console presents a name, address, digest or token.
 */
export function DataValue({
  value,
  copy = true,
  className,
  copyLabel,
  title,
}: {
  value: string | null | undefined
  copy?: boolean
  className?: string
  copyLabel?: string
  title?: string
}) {
  const text = value ?? '—'
  return (
    <span className={cn('group/data inline-flex min-w-0 max-w-full items-center gap-1', className)} title={title ?? text}>
      <span className="font-data truncate">{text}</span>
      {copy && value && <CopyButton value={value} label={copyLabel} className="opacity-0 transition-opacity group-hover/data:opacity-100 focus-visible:opacity-100" />}
    </span>
  )
}
