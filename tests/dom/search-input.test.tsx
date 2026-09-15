import { act, fireEvent, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DebouncedSearch, SearchInput, useDebouncedValue } from '@/components/app/search-input'
import { renderWithProviders } from './utils/render-with-providers'

/**
 * The debounce is a correctness feature, not a nicety: zones and query logs are
 * server-paginated, so without it every keystroke is a round trip to a
 * single-threaded admin API on a LAN box. The regressions worth catching are
 * therefore timing-shaped and need fake timers:
 *
 *  - `useDebouncedValue` must collapse a burst of changes into the *last* value
 *    and emit nothing until the delay elapses. A broken cleanup would fire once
 *    per keystroke (the exact request storm the hook exists to prevent).
 *  - `DebouncedSearch` must call `onSearch` with the settled value, not on every
 *    change, while still emitting the initial value on mount so the first query
 *    runs.
 *  - `SearchInput` is fully controlled: it reflects `value`, forwards every
 *    change, offers a clear affordance only when non-empty, and honours
 *    `autoFocus` (operators land on these pages and start typing).
 */

function DebounceHarness({ delay }: { delay: number }) {
  const [value, setValue] = React.useState('initial')
  const debounced = useDebouncedValue(value, delay)
  return (
    <div>
      <output data-testid="debounced">{debounced}</output>
      <button type="button" onClick={() => setValue('a')}>
        set-a
      </button>
      <button type="button" onClick={() => setValue('ab')}>
        set-ab
      </button>
      <button type="button" onClick={() => setValue('abc')}>
        set-abc
      </button>
    </div>
  )
}

describe('useDebouncedValue', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('emits nothing until the delay elapses, then only the last value', () => {
    renderWithProviders(<DebounceHarness delay={250} />)
    const debounced = screen.getByTestId('debounced')
    expect(debounced).toHaveTextContent('initial')

    // A burst of three changes with no time passing in between.
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'set-a' }))
      fireEvent.click(screen.getByRole('button', { name: 'set-ab' }))
      fireEvent.click(screen.getByRole('button', { name: 'set-abc' }))
    })

    // Still the initial value: the debounce has not elapsed.
    expect(debounced).toHaveTextContent('initial')

    act(() => {
      vi.advanceTimersByTime(250)
    })

    // Only the final value is ever published — 'a' and 'ab' were swallowed.
    expect(debounced).toHaveTextContent('abc')
  })

  it('restarts the timer on each change so a slow typist never emits mid-word', () => {
    renderWithProviders(<DebounceHarness delay={250} />)
    const debounced = screen.getByTestId('debounced')

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'set-a' }))
    })
    act(() => {
      vi.advanceTimersByTime(200)
    })
    // 200ms into a 250ms window a new change arrives; the timer must reset.
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'set-ab' }))
    })
    act(() => {
      vi.advanceTimersByTime(200)
    })
    expect(debounced).toHaveTextContent('initial')
    act(() => {
      vi.advanceTimersByTime(50)
    })
    expect(debounced).toHaveTextContent('ab')
  })
})

describe('DebouncedSearch', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('publishes the initial value on mount, then the settled value after the delay', () => {
    const onSearch = vi.fn()
    renderWithProviders(<DebouncedSearch onSearch={onSearch} />)

    // The mount effect fires once so the first query runs with the initial value.
    expect(onSearch).toHaveBeenCalledWith('')

    const input = screen.getByRole('searchbox')
    act(() => {
      fireEvent.change(input, { target: { value: 'zon' } })
    })
    // Not yet: the change is still inside the debounce window.
    expect(onSearch).not.toHaveBeenCalledWith('zon')

    act(() => {
      vi.advanceTimersByTime(250)
    })
    expect(onSearch).toHaveBeenLastCalledWith('zon')
  })

  it('collapses a burst of keystrokes into a single onSearch call', () => {
    const onSearch = vi.fn()
    renderWithProviders(<DebouncedSearch onSearch={onSearch} />)
    const input = screen.getByRole('searchbox')

    act(() => {
      fireEvent.change(input, { target: { value: 'e' } })
      fireEvent.change(input, { target: { value: 'ex' } })
      fireEvent.change(input, { target: { value: 'example.com' } })
      vi.advanceTimersByTime(250)
    })

    // One mount call ('') plus exactly one settled call.
    expect(onSearch).toHaveBeenCalledTimes(2)
    expect(onSearch).toHaveBeenLastCalledWith('example.com')
  })
})

describe('SearchInput', () => {
  it('reflects the controlled value and forwards changes', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    renderWithProviders(<SearchInput value="abc" onChange={onChange} />)
    const input = screen.getByRole('searchbox')
    expect(input).toHaveValue('abc')
    await user.type(input, 'd')
    expect(onChange).toHaveBeenCalledWith('abcd')
  })

  it('uses the shared search placeholder as the accessible name', () => {
    renderWithProviders(<SearchInput value="" onChange={() => {}} />)
    expect(screen.getByRole('searchbox', { name: '输入以筛选…' })).toBeInTheDocument()
  })

  it('shows a clear button only when there is text, and it clears on click', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const { rerender } = renderWithProviders(<SearchInput value="" onChange={onChange} />)
    expect(screen.queryByRole('button', { name: '清除' })).not.toBeInTheDocument()

    rerender(<SearchInput value="abc" onChange={onChange} />)
    await user.click(screen.getByRole('button', { name: '清除' }))
    expect(onChange).toHaveBeenCalledWith('')
  })

  it('focuses the field on mount when autoFocus is set', () => {
    renderWithProviders(<SearchInput value="" onChange={() => {}} autoFocus />)
    expect(screen.getByRole('searchbox')).toHaveFocus()
  })
})
