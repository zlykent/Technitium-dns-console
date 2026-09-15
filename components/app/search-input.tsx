'use client'

import { useTranslations } from 'next-intl'
import { Search, X } from 'lucide-react'
import * as React from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

/**
 * Debounced search field for table toolbars.
 *
 * The debounce is not cosmetic: zones and query logs are server-paginated, so
 * every keystroke would otherwise be a round trip to a single-threaded admin API
 * on a LAN box. 250 ms keeps typing feeling instant while collapsing a burst of
 * keystrokes into one request.
 */

export function useDebouncedValue<T>(value: T, delay = 250): T {
  const [debounced, setDebounced] = React.useState(value)
  React.useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])
  return debounced
}

export interface SearchInputProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  className?: string
  id?: string
  autoFocus?: boolean
}

export function SearchInput({ value, onChange, placeholder, className, id, autoFocus }: SearchInputProps) {
  const tc = useTranslations('common')
  const label = placeholder ?? tc('table.searchPlaceholder')

  return (
    <div className={cn('relative min-w-0 flex-1 sm:max-w-xs', className)}>
      <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
      <Input
        id={id}
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={label}
        aria-label={label}
        autoFocus={autoFocus}
        autoComplete="off"
        className="h-8 pr-8 pl-8 text-sm"
      />
      {value && (
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          onClick={() => onChange('')}
          aria-label={tc('actions.clear')}
          className="absolute top-1/2 right-1 -translate-y-1/2 text-muted-foreground"
        >
          <X aria-hidden />
        </Button>
      )}
    </div>
  )
}

/**
 * Search field that owns its own text state and publishes a debounced value.
 * Pages that drive a server-side `keyword` parameter use this one.
 */
export function DebouncedSearch({
  onSearch,
  placeholder,
  delay = 250,
  className,
  initialValue = '',
}: {
  onSearch: (value: string) => void
  placeholder?: string
  delay?: number
  className?: string
  initialValue?: string
}) {
  const [value, setValue] = React.useState(initialValue)
  const debounced = useDebouncedValue(value, delay)

  React.useEffect(() => {
    onSearch(debounced)
    // `onSearch` is expected to be stable (a query-setter); re-running on its
    // identity would reset the search on every parent render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced])

  return <SearchInput value={value} onChange={setValue} placeholder={placeholder} className={className} />
}
