import { DISK_MAGIC, RAM_BASE } from '../spec'
import { assemble, pad4 } from './asm'

export const OK_SRC = `    lui a0, 0x10001
    addi a1, zero, 79
    sw a1, 0(a0)
    addi a1, zero, 75
    sw a1, 0(a0)
hang:
    jal zero, hang
`

export const PIXEL_SRC = `    lui t2, 0x10003
    lw t2, 4(t2)
    beq t2, zero, hang
    lui a1, 0xE86
    addi a1, a1, -726
    lui a0, 0x10010
    addi t0, zero, 16
row:
    addi t1, zero, 16
col:
    sw a1, 0(a0)
    addi a0, a0, 4
    addi t1, t1, -1
    bne t1, zero, col
    lui t3, 0x10003
    lw t3, 4(t3)
    addi t3, t3, -16
    slli t3, t3, 2
    add a0, a0, t3
    addi t0, t0, -1
    bne t0, zero, row
hang:
    jal zero, hang
`

export const KEY_SRC = `    li t0, handler
    csrw mtvec, t0
    li t0, 2048
    csrrs zero, mie, t0
    li t0, 8
    csrrs zero, mstatus, t0
wait:
    jal zero, wait
handler:
    li t0, 0x10002000
    lw t1, 0(t0)
    li t0, 0x10001000
    sw t1, 0(t0)
    mret
`

export function makeDisk(payload: Uint8Array, load = RAM_BASE): Uint8Array {
  const body = pad4(payload)
  const disk = new Uint8Array(16 + body.length)
  const view = new DataView(disk.buffer)
  view.setUint32(0, DISK_MAGIC, true)
  view.setUint32(4, load, true)
  view.setUint32(8, body.length, true)
  disk.set(body, 16)
  return disk
}

export function padTo(bytes: Uint8Array, size: number): Uint8Array {
  if (bytes.length >= size) return bytes
  const out = new Uint8Array(size)
  out.set(bytes)
  return out
}

export const KERNEL_LOAD_SIZE = 80 * 1024

export function assemblePayload(source: string, base = RAM_BASE): Uint8Array {
  return assemble(source, base).bytes
}

export function bootRom(source: string): Uint8Array {
  const bytes = assemble(source, 0).bytes
  if (bytes.length > 4096) throw new Error(`引导 ROM 有 ${bytes.length} 字节，超过 4 KiB`)
  const rom = new Uint8Array(4096)
  rom.set(bytes)
  return rom
}

export function kernelDisk(source: string): Uint8Array {
  return makeDisk(padTo(assemblePayload(source), KERNEL_LOAD_SIZE))
}
