'use client'

import { Upload } from 'lucide-react'
import * as React from 'react'
import { cn } from '@/lib/utils'

/**
 * Drag-and-drop ZIP picker shared by the install and update dialogs.
 *
 * Extracted because both dialogs need the identical affordance and the a11y
 * wiring is fiddly enough to want in one place: the visible target is a
 * `role="button"` div (keyboard-focusable, Enter/Space to open) while the real
 * `<input type="file">` stays `sr-only` beside it — nesting a form control
 * inside a button role would be announced twice. The parent owns the
 * `<FieldLabel htmlFor={id}>` so the hidden input is still labelled.
 *
 * It is deliberately dumb: it holds no `File` state of its own, surfacing every
 * pick/drop through `onFileChange` so the dialog keeps the `File` next to the
 * mutation that uploads it (a `File` is not serialisable and must never enter a
 * zod schema or query cache).
 */

export interface ZipDropzoneProps {
  /** id of the hidden input; the parent's `<FieldLabel htmlFor>` points here. */
  id: string
  file: File | null
  onFileChange: (file: File | null) => void
  /** Text shown while nothing is chosen — the drop/click prompt. */
  prompt: string
  disabled?: boolean
  className?: string
}

export function ZipDropzone({ id, file, onFileChange, prompt, disabled = false, className }: ZipDropzoneProps) {
  const inputRef = React.useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = React.useState(false)

  function open() {
    if (!disabled) inputRef.current?.click()
  }

  return (
    <>
      <div
        data-slot="zip-dropzone"
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-disabled={disabled || undefined}
        onClick={open}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            open()
          }
        }}
        onDragOver={(event) => {
          if (disabled) return
          event.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          if (disabled) return
          event.preventDefault()
          setDragging(false)
          const next = event.dataTransfer.files?.[0]
          if (next) onFileChange(next)
        }}
        className={cn(
          'flex flex-col items-center justify-center gap-2 rounded-md border border-dashed px-4 py-6 text-center transition-colors',
          'focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none',
          dragging ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/40 hover:bg-accent/40',
          disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
          className,
        )}
      >
        <Upload className="size-5 text-muted-foreground" aria-hidden />
        <span className="font-data text-xs break-all text-muted-foreground">{file ? file.name : prompt}</span>
      </div>

      <input
        ref={inputRef}
        id={id}
        type="file"
        accept=".zip,application/zip,application/x-zip-compressed"
        className="sr-only"
        disabled={disabled}
        onChange={(event) => onFileChange(event.target.files?.[0] ?? null)}
      />
    </>
  )
}
