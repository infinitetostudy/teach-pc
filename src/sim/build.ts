import { type Assembly, resolve } from '../catalog'
import { evaluatePost, postPassed } from '../post'
import { createMachine, type Machine } from './machine'

export function wattsOf(slots: Assembly): { used: number; rated: number } {
  const L = resolve(slots)
  return {
    used: (L.cpu?.watts ?? 0) + (L.gpu?.watts ?? 0) + (L.ram?.watts ?? 0) + (L.disk?.watts ?? 0),
    rated: L.psu?.watts ?? 0,
  }
}

export function buildMachine(slots: Assembly, disk: Uint8Array, rom: Uint8Array): Machine | null {
  if (!postPassed(evaluatePost(slots))) return null
  const L = resolve(slots)
  const fb = L.gpu?.mode === 'fb'
  const power = wattsOf(slots)
  return createMachine({
    ramBytes: L.ram?.ramBytes ?? 0,
    fbWidth: fb ? L.gpu?.width ?? 0 : 0,
    fbHeight: fb ? L.gpu?.height ?? 0 : 0,
    gpuMode: fb ? 'fb' : 'text',
    scanHeight: L.gpu?.height ?? 25,
    disk,
    rom,
    watts: power.used,
    ratedWatts: power.rated,
    pipeline: Boolean(L.cpu?.pipeline),
  })
}
