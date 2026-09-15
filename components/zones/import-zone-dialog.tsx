'use client'

import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { Upload } from 'lucide-react'
import * as React from 'react'
import { Controller, useForm, useWatch, type Control, type FieldPath, type FieldValues } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'
import { ErrorState } from '@/components/app/states'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { describeError } from '@/lib/api/client'
import { importZone, listZones } from '@/lib/api/domains/zones'
import { ZONE_IMPORT_MODES, type ZoneImportMode } from '@/lib/api/enums'
import { queryKeys } from '@/lib/api/query-keys'
import { useTargetKey } from '@/lib/servers/provider'

/**
 * Import-zone dialog.
 *
 * `zones/import` merges a BIND-format zone file into an *existing* zone, so the
 * dialog is really two independent axes:
 *
 *  - **source** — either pasted text (sent as a form field) or an uploaded file
 *    (sent multipart). `importZone` branches on `mode` and the SDK builds the
 *    right body, so the dialog only has to keep the `<File>` out of the zod
 *    schema (a `File` is not serialisable) and hold it in local state.
 *  - **overwrite behaviour** — three separate switches that Technitium treats
 *    orthogonally: replace matching records (`overwrite`), wipe the zone first
 *    (`overwriteZone`), and take the file's SOA serial instead of bumping ours
 *    (`overwriteSoaSerial`). All three default off, which is the safe merge.
 *
 * The target zone is chosen from the live inventory (fetched on open) rather
 * than typed, because importing into a non-existent zone is a server error.
 */

export interface ImportZoneDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Pre-selects the target when opened from a row action. */
  initialZone?: string
}

export function ImportZoneDialog({ open, onOpenChange, initialZone }: ImportZoneDialogProps) {
  const t = useTranslations('zones')
  const tc = useTranslations('common')
  const target = useTargetKey()
  const queryClient = useQueryClient()
  const [file, setFile] = React.useState<File | null>(null)

  const schema = React.useMemo(
    () =>
      z
        .object({
          zone: z.string().min(1, tc('form.required')),
          mode: z.enum(ZONE_IMPORT_MODES),
          text: z.string(),
          overwrite: z.boolean(),
          overwriteZone: z.boolean(),
          overwriteSoaSerial: z.boolean(),
        })
        .superRefine((data, ctx) => {
          if (data.mode === 'Text' && !data.text.trim()) {
            ctx.addIssue({ code: 'custom', path: ['text'], message: t('import.emptyText') })
          }
        }),
    [t, tc],
  )

  type FormValues = z.infer<typeof schema>

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      zone: initialZone ?? '',
      mode: 'File',
      text: '',
      overwrite: false,
      overwriteZone: false,
      overwriteSoaSerial: false,
    },
  })

  const mode = useWatch({ control: form.control, name: 'mode' })

  const inventory = useQuery({
    // Distinct from the list page's key on purpose: this one asks for 1000 rows
    // to populate the "import into an existing zone" picker, and sharing the key
    // would let whichever query resolved last overwrite the other's page.
    queryKey: queryKeys.zoneList(target, 1, '', { picker: true, pageSize: 1000 }),
    queryFn: () => listZones({ pageNumber: 1, zonesPerPage: 1000 }),
    enabled: open,
    staleTime: 30_000,
  })

  // Re-seed the target whenever the dialog opens with a new `initialZone`.
  React.useEffect(() => {
    if (open) form.setValue('zone', initialZone ?? form.getValues('zone'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialZone])

  const fileInputRef = React.useRef<HTMLInputElement>(null)

  const mutate = useMutation({
    mutationFn: (values: FormValues) =>
      importZone({
        zone: values.zone,
        mode: values.mode,
        text: values.mode === 'Text' ? values.text : undefined,
        file: values.mode === 'File' ? (file ?? undefined) : undefined,
        overwrite: values.overwrite,
        overwriteZone: values.overwriteZone,
        overwriteSoaSerial: values.overwriteSoaSerial,
      }),
    onSuccess: () => {
      toast.success(t('import.success'))
      void queryClient.invalidateQueries({ queryKey: queryKeys.domain(target, 'zones') })
      close()
    },
    onError: (error) => toast.error(describeError(error).message),
  })

  function close() {
    onOpenChange(false)
    setTimeout(() => {
      form.reset()
      setFile(null)
      mutate.reset()
    }, 0)
  }

  function onSubmit(values: FormValues) {
    if (values.mode === 'File' && !file) {
      toast.error(t('import.noFile'))
      return
    }
    mutate.mutate(values)
  }

  const zoneNames = inventory.data?.zones.map((zone) => zone.name) ?? []

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t('import.title')}</DialogTitle>
          <DialogDescription>{t('import.subtitle')}</DialogDescription>
        </DialogHeader>

        <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4" noValidate>
          <Field>
            <FieldLabel htmlFor="iz-zone" required>
              {t('import.zoneLabel')}
            </FieldLabel>
            <Controller
              control={form.control}
              name="zone"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger id="iz-zone" className="font-data">
                    <SelectValue placeholder={inventory.isPending ? tc('table.loading') : undefined} />
                  </SelectTrigger>
                  <SelectContent>
                    {zoneNames.map((name) => (
                      <SelectItem key={name} value={name} className="font-data">
                        {name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
            <FieldError>{form.formState.errors.zone?.message}</FieldError>
          </Field>

          <Field>
            <FieldLabel htmlFor="iz-mode">{t('import.modeLabel')}</FieldLabel>
            <Controller
              control={form.control}
              name="mode"
              render={({ field }) => (
                <Select value={field.value} onValueChange={(value) => field.onChange(value as ZoneImportMode)}>
                  <SelectTrigger id="iz-mode">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="File">{t('import.modeFile')}</SelectItem>
                    <SelectItem value="Text">{t('import.modeText')}</SelectItem>
                  </SelectContent>
                </Select>
              )}
            />
          </Field>

          {mode === 'Text' ? (
            <Field>
              <FieldLabel htmlFor="iz-text" required>
                {t('import.textLabel')}
              </FieldLabel>
              <Textarea
                id="iz-text"
                className="font-data min-h-40"
                placeholder={t('import.textPlaceholder')}
                spellCheck={false}
                aria-invalid={Boolean(form.formState.errors.text)}
                {...form.register('text')}
              />
              <FieldDescription>{t('import.previewHint')}</FieldDescription>
              <FieldError>{form.formState.errors.text?.message}</FieldError>
            </Field>
          ) : (
            <Field>
              <FieldLabel>{t('import.fileLabel')}</FieldLabel>
              <div className="flex items-center gap-2 rounded-md border border-dashed border-border px-3 py-3">
                <Upload className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                <span className="font-data min-w-0 flex-1 truncate text-xs text-muted-foreground">
                  {file ? file.name : t('import.noFile')}
                </span>
                <input
                  ref={fileInputRef}
                  type="file"
                  className="sr-only"
                  onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                />
                <Button type="button" variant="outline" size="xs" onClick={() => fileInputRef.current?.click()}>
                  {tc('actions.upload')}
                </Button>
              </div>
            </Field>
          )}

          <div className="flex flex-col gap-2">
            <SwitchRow
              id="iz-overwrite"
              label={t('import.overwrite')}
              help={t('import.overwriteHelp')}
              control={form.control}
              name="overwrite"
            />
            <SwitchRow
              id="iz-overwrite-zone"
              label={t('import.overwriteZone')}
              help={t('import.overwriteZoneHelp')}
              control={form.control}
              name="overwriteZone"
            />
            <SwitchRow
              id="iz-overwrite-soa"
              label={t('import.overwriteSoaSerial')}
              help={t('import.overwriteSoaSerialHelp')}
              control={form.control}
              name="overwriteSoaSerial"
            />
          </div>

          {mutate.error ? <ErrorState error={mutate.error} compact /> : null}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={close} disabled={mutate.isPending}>
              {tc('actions.cancel')}
            </Button>
            <Button type="submit" loading={mutate.isPending}>
              {!mutate.isPending && <Upload className="size-4" aria-hidden />}
              {mutate.isPending ? t('import.submitting') : t('import.submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** Label + Switch on one row, wired through react-hook-form's `Controller`. */
function SwitchRow<TFieldValues extends FieldValues>({
  id,
  label,
  help,
  control,
  name,
}: {
  id: string
  label: string
  help?: string
  control: Control<TFieldValues>
  name: FieldPath<TFieldValues>
}) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-md border border-border/60 px-3 py-2">
      <div className="min-w-0">
        <label htmlFor={id} className="text-sm font-medium">
          {label}
        </label>
        {help && <p className="mt-0.5 text-xs text-muted-foreground">{help}</p>}
      </div>
      <Controller
        control={control}
        name={name}
        render={({ field }) => <Switch id={id} checked={Boolean(field.value)} onCheckedChange={field.onChange} />}
      />
    </div>
  )
}
