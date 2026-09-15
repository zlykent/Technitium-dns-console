import type {
  DnsKeyState,
  DnssecKeyType,
  DsAlgorithm,
  EcdsaCurve,
  EddsaCurve,
  NxProofType,
  RsaHashAlgorithm,
  RsaKeySize,
  SigningAlgorithm,
} from '@/lib/api/enums'
import type { DnssecStatus, ZoneType } from '@/lib/api/enums'

/** `zones/dnssec/properties/get` */
export interface DnssecProperties {
  name: string
  type: ZoneType
  disabled: boolean
  dnssecStatus: DnssecStatus | 'Unsigned'
  dnsKeyTtl: number
  dnssecPrivateKeys: DnssecPrivateKey[]
  nxProof?: NxProofType
  nsec3Iterations?: number
  nsec3Salt?: string
}

export interface DnssecPrivateKey {
  keyTag: number
  keyType: DnssecKeyType
  algorithm: SigningAlgorithm
  algorithmNumber: number
  state: DnsKeyState
  stateChangedOn: string
  stateActiveBy: string | null
  stateReadyBy: string | null
  isRetiring: boolean
  rolloverDays: number
}

/** `zones/dnssec/viewDS` — the records to paste into the parent zone. */
export interface DsRecordView {
  dsRecords: DsRecord[]
}

export interface DsRecord {
  keyTag: number
  algorithm: string
  algorithmNumber: number
  publicKey: string
  dnsKeyState: DnsKeyState
  dnsKeyStateReadyBy: string | null
  isRetiring: boolean
  digests: DsDigest[]
}

export interface DsDigest {
  digestType: string
  digestTypeNumber: number
  digest: string
}

/**
 * `zones/dnssec/sign`.
 *
 * There is no "generation mode" parameter upstream: leaving `pemKskPrivateKey` /
 * `pemZskPrivateKey` empty is what asks the server to generate the key. The UI's
 * Automatic/UseSpecified radio (`KeyGenerationMode`) only decides whether the
 * PEM textarea is shown.
 *
 * `algorithm` decides which size/curve parameters apply:
 *
 *   RSA    -> hashAlgorithm + kskKeySize + zskKeySize
 *   ECDSA  -> curve (P256 | P384)
 *   EDDSA  -> curve (ED25519 | ED448)
 *
 * `iterations` / `saltLength` are sent only when `nxProof` is `NSEC3`.
 */
export interface SignZoneParams {
  zone: string
  algorithm: SigningAlgorithm
  pemKskPrivateKey?: string
  pemZskPrivateKey?: string
  dnsKeyTtl: number
  zskRolloverDays: number
  nxProof: NxProofType
  iterations?: number
  saltLength?: number
  hashAlgorithm?: RsaHashAlgorithm
  kskKeySize?: RsaKeySize
  zskKeySize?: RsaKeySize
  curve?: EcdsaCurve | EddsaCurve
  node?: string
}

export interface AddPrivateKeyParams {
  zone: string
  keyType: DnssecKeyType
  algorithm: SigningAlgorithm
  pemPrivateKey?: string
  rolloverDays: number
  hashAlgorithm?: RsaHashAlgorithm
  keySize?: RsaKeySize
  curve?: EcdsaCurve | EddsaCurve
  node?: string
}

export interface ZoneKeyParams {
  zone: string
  keyTag: number
  node?: string
}

export interface UpdatePrivateKeyParams extends ZoneKeyParams {
  rolloverDays: number
}

export interface UpdateDnsKeyTtlParams {
  zone: string
  ttl: number
  node?: string
}

export interface Nsec3Params {
  zone: string
  iterations: number
  saltLength: number
  node?: string
}

/** DS record algorithm numbers, for rendering the numeric column. */
export const DS_ALGORITHM_NUMBERS: Record<DsAlgorithm, number> = {
  RSAMD5: 1,
  RSASHA1: 5,
  RSASHA256: 8,
  RSASHA512: 10,
  ECDSAP256SHA256: 13,
  ECDSAP384SHA384: 14,
  ED25519: 15,
  ED448: 16,
}

export const DS_DIGEST_TYPE_NUMBERS: Record<string, number> = {
  SHA1: 1,
  SHA256: 2,
  SHA384: 4,
}
