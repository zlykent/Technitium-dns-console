'use client'

import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { CirclePlus, Network, RefreshCw } from 'lucide-react'
import * as React from 'react'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { PageHeader, PageShell } from '@/components/app/page-shell'
import { ErrorState } from '@/components/app/states'
import { LeasesPanel } from '@/components/dhcp/leases-panel'
import { ScopeForm } from '@/components/dhcp/scope-form'
import { ScopeList } from '@/components/dhcp/scope-list'
import { getScope, listScopes } from '@/lib/api/domains/dhcp'
import { queryKeys } from '@/lib/api/query-keys'
import type { DhcpScope, ScopeSummary } from '@/lib/api/types/dhcp'
import { useCan } from '@/lib/auth/session'
import { useTargetKey } from '@/lib/servers/provider'

/**
 * DHCP management — scopes and leases.
 *
 * Two tabs share one page: "Scopes" shows the inventory with inline enable /
 * disable and the create/edit form; "Leases" shows the full lease table with
 * client-side filtering (the upstream `dhcp/leases/list` endpoint has no scope
 * parameter).
 *
 * The scope form opens as a large dialog rather than navigating away because:
 *  - operators frequently toggle between scopes and leases;
 *  - the form is self-contained (no server round-trip until save);
 *  - the dialog approach avoids a route segment that would need its own layout.
 *
 * When editing, `getScope` is fetched fresh rather than relying on the list
 * payload, because `dhcp/scopes/list` returns only a summary (7 fields) while
 * the form needs all 23.
 */

export function DhcpView() {
  const t = useTranslations('dhcp')
  const tc = useTranslations('common')
  const target = useTargetKey()
  const can = useCan('DhcpServer')

  const [tab, setTab] = React.useState<'scopes' | 'leases'>('scopes')
  const [formOpen, setFormOpen] = React.useState(false)
  const [editingScope, setEditingScope] = React.useState<DhcpScope | null>(null)
  // Bumped on every open so `ScopeForm` remounts with fresh default values
  // instead of relying on an in-effect reset (which cascades renders).
  const [formNonce, setFormNonce] = React.useState(0)

  const scopes = useQuery({
    queryKey: queryKeys.dhcpScopes(target),
    queryFn: () => listScopes(),
    enabled: can.canView,
  })

  /** Fetch full scope data when the operator clicks "edit". */
  const scopeDetail = useQuery({
    queryKey: queryKeys.dhcpScope(target, editingScope?.name ?? '__pending__'),
    queryFn: () => getScope(editingScope!.name),
    enabled: Boolean(editingScope?.name) && formOpen,
  })

  function handleCreate() {
    setEditingScope(null)
    setFormNonce((n) => n + 1)
    setFormOpen(true)
  }

  function handleEdit(summary: ScopeSummary) {
    // Seed with the summary so the form has a name immediately; the detail
    // query will replace it with the full 23-field payload.
    setEditingScope({
      name: summary.name,
      enabled: summary.enabled,
      startingAddress: summary.startingAddress,
      endingAddress: summary.endingAddress,
      subnetMask: summary.subnetMask,
      leaseTimeDays: 1,
      leaseTimeHours: 0,
      leaseTimeMinutes: 0,
      offerDelayTime: 0,
      pingCheckEnabled: false,
      pingCheckTimeout: 1000,
      pingCheckRetries: 2,
      domainName: '',
      dnsUpdates: true,
      dnsOverwriteForDynamicLease: false,
      dnsTtl: 900,
      routerAddress: '',
      useThisDnsServer: true,
      dnsServers: [],
      exclusions: [],
      reservedLeases: [],
      allowOnlyReservedLeases: false,
      blockLocallyAdministeredMacAddresses: false,
      ignoreClientIdentifierOption: false,
    })
    setFormNonce((n) => n + 1)
    setFormOpen(true)
  }

  // Once the detail query resolves, replace the placeholder scope data.
  const resolvedScope = scopeDetail.data ?? editingScope

  return (
    <PageShell>
      <PageHeader
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => void scopes.refetch()} loading={scopes.isFetching}>
              {!scopes.isFetching && <RefreshCw className="size-3.5" aria-hidden />}
              {tc('actions.refresh')}
            </Button>
            {can.canModify && (
              <Button size="sm" onClick={handleCreate}>
                <CirclePlus className="size-3.5" aria-hidden />
                {t('scopes.add')}
              </Button>
            )}
          </>
        }
      />

      {scopes.error ? (
        <ErrorState error={scopes.error} onRetry={() => void scopes.refetch()} />
      ) : (
        <Tabs value={tab} onValueChange={(v) => setTab(v as 'scopes' | 'leases')}>
          <TabsList>
            <TabsTrigger value="scopes">
              <Network className="size-4" aria-hidden />
              {t('tabs.scopes')}
            </TabsTrigger>
            <TabsTrigger value="leases">{t('tabs.leases')}</TabsTrigger>
          </TabsList>

          <TabsContent value="scopes">
            <ScopeList
              scopes={scopes.data?.scopes ?? []}
              loading={scopes.isPending}
              error={scopes.error}
              onRetry={() => void scopes.refetch()}
              onEdit={handleEdit}
            />
          </TabsContent>

          <TabsContent value="leases">
            <LeasesPanel scopes={scopes.data?.scopes ?? []} />
          </TabsContent>
        </Tabs>
      )}

      <ScopeForm
        key={`${resolvedScope?.name ?? '__new__'}-${formNonce}`}
        open={formOpen}
        onOpenChange={setFormOpen}
        scope={resolvedScope}
      />
    </PageShell>
  )
}
