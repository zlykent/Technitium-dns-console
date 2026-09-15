'use client'

import { useTranslations } from 'next-intl'
import { Globe, Pencil, Server, ShieldCheck } from 'lucide-react'
import * as React from 'react'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { DEFAULT_RESOLVER, PUBLIC_RESOLVERS, type PublicResolver } from '@/lib/api/domains/dns-client'
import type { ResolverProtocol } from '@/lib/api/enums'
import { cn } from '@/lib/utils'

/**
 * Name-server picker for the DNS client tool.
 *
 * The stock console keeps a flat `<datalist>` and infers the transport from the
 * chosen text (`dnsclient.js` lines 30-46: a `https://` prefix means DoH, `:853`
 * means DoT, everything else falls back to UDP). We make that inference explicit
 * instead: `PUBLIC_RESOLVERS` entries carry an optional `protocol`, and picking
 * one calls `onPresetChange(address, protocol)` so the form can switch the
 * transport in the same tick. Picking a plain address passes `undefined`, which
 * the form reads as "keep UDP/TCP, drop any DoH/DoT/DoQ".
 *
 * Non-obvious detail: `this-server` is not a real address — it is the sentinel
 * the API understands as "recurse on this instance" (`DEFAULT_RESOLVER`), so it
 * gets its own group at the top rather than being lumped in with the public IPs.
 *
 * "Custom" is a mode, not a value: selecting it swaps the combobox for a free
 * text `Input` and the effective server becomes whatever the operator typed.
 * The parent owns that string so a replayed history entry can prefill it.
 */

/** Sentinel `Select` value meaning "the operator is typing their own server". */
export const CUSTOM_RESOLVER = '__custom__'

/** The public list split into the three groups the picker shows. */
function useResolverGroups() {
  return React.useMemo(() => {
    const thisServer: PublicResolver[] = []
    const doh: PublicResolver[] = []
    const publicIp: PublicResolver[] = []
    for (const entry of PUBLIC_RESOLVERS) {
      if (entry.address === DEFAULT_RESOLVER) thisServer.push(entry)
      else if (entry.protocol) doh.push(entry)
      else publicIp.push(entry)
    }
    return { thisServer, doh, publicIp }
  }, [])
}

export interface ResolverPickerProps {
  /** Currently selected preset address, or `CUSTOM_RESOLVER`. */
  preset: string
  /** Text of the custom input; only meaningful when `preset === CUSTOM_RESOLVER`. */
  customServer: string
  onPresetChange: (preset: string, protocol?: ResolverProtocol) => void
  onCustomServerChange: (value: string) => void
  id?: string
  disabled?: boolean
  className?: string
}

export function ResolverPicker({
  preset,
  customServer,
  onPresetChange,
  onCustomServerChange,
  id,
  disabled,
  className,
}: ResolverPickerProps) {
  const t = useTranslations('dnsClient')
  const groups = useResolverGroups()
  const isCustom = preset === CUSTOM_RESOLVER

  function handleValueChange(value: string) {
    if (value === CUSTOM_RESOLVER) {
      onPresetChange(CUSTOM_RESOLVER)
      return
    }
    const match = PUBLIC_RESOLVERS.find((entry) => entry.address === value)
    onPresetChange(value, match?.protocol)
  }

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <Field>
        <FieldLabel htmlFor={id}>{t('form.presets')}</FieldLabel>
        <Select value={isCustom ? CUSTOM_RESOLVER : preset} onValueChange={handleValueChange} disabled={disabled}>
          <SelectTrigger id={id} className="font-data">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectLabel>{t('form.groupThisServer')}</SelectLabel>
              {groups.thisServer.map((entry) => (
                <ResolverItem key={entry.address} entry={entry} icon={<Server className="size-4" aria-hidden />} />
              ))}
            </SelectGroup>

            <SelectSeparator />
            <SelectGroup>
              <SelectLabel>{t('form.groupPublic')}</SelectLabel>
              {groups.publicIp.map((entry) => (
                <ResolverItem key={entry.address} entry={entry} icon={<Globe className="size-4" aria-hidden />} />
              ))}
            </SelectGroup>

            <SelectSeparator />
            <SelectGroup>
              <SelectLabel>{t('form.groupDoh')}</SelectLabel>
              {groups.doh.map((entry) => (
                <ResolverItem key={entry.address} entry={entry} icon={<ShieldCheck className="size-4" aria-hidden />} />
              ))}
            </SelectGroup>

            <SelectSeparator />
            <SelectGroup>
              <SelectItem value={CUSTOM_RESOLVER}>
                <Pencil className="size-4" aria-hidden />
                <span>{t('form.groupCustom')}</span>
              </SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
      </Field>

      {isCustom && (
        <Field>
          <FieldLabel htmlFor={`${id}-custom`}>{t('form.customServer')}</FieldLabel>
          <Input
            id={`${id}-custom`}
            type="text"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            className="font-data"
            value={customServer}
            disabled={disabled}
            placeholder={t('form.serverPlaceholder')}
            aria-label={t('form.server')}
            onChange={(event) => onCustomServerChange(event.target.value)}
          />
          <FieldDescription>{t('form.serverHelp')}</FieldDescription>
        </Field>
      )}
    </div>
  )
}

/** One preset row: a leading icon, the friendly name, then the raw address. */
function ResolverItem({ entry, icon }: { entry: PublicResolver; icon: React.ReactNode }) {
  return (
    <SelectItem value={entry.address}>
      {icon}
      <span className="flex min-w-0 items-baseline gap-2">
        <span className="truncate">{entry.name}</span>
        <span className="font-data truncate text-xs text-muted-foreground">{entry.address}</span>
      </span>
    </SelectItem>
  )
}
