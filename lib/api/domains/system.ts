import { apiRequest } from '../client'
import type { ServerStatus } from '../types/common'

/** The one endpoint that needs no session — used by the login screen. */
export function getStatus(): Promise<ServerStatus> {
  return apiRequest<ServerStatus>('status')
}
