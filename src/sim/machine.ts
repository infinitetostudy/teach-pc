import {
  BOOT_ROM_BASE,
  BOOT_ROM_SIZE,
  DISK_BASE,
  FB_BASE,
  INFO_BASE,
  KBD_BASE,
  RAM_BASE,
  TIMER_BASE,
  UART_BASE,
} from '../spec'

export type Priv = 'M' | 'U'

export type Trace = {
  pc: number
  instr: number
  asm: string
  rs1: number
  rs2: number
  rd: number
  rs1v: number
  rs2v: number
  alu: number
  memAddr: number | null
  memVal: number | null
  memWrite: boolean
  wb: number | null
  nextPc: number
  trap: string | null
}

export type Access = {
  addr: number
  write: boolean
  size: number
  region: string
}

export type Fault = {
  va: number
  pteAddr: number
  pte: number
  level: 1 | 2
  access: string
}

export type Machine = {
  pc: number
  regs: number[]
  ram: Uint8Array
  ramOwned: boolean
  rom: Uint8Array
  fb: Uint8Array
  fbOwned: boolean
  fbWidth: number
  fbHeight: number
  gpuMode: 'text' | 'fb'
  scanHeight: number
  text: string
  kbdCode: number
  kbdReady: boolean
  kbdIrq: boolean
  lastKey: number
  mtime: number
  mtimecmp: number
  disk: Uint8Array
  mstatus: number
  mie: number
  mtvec: number
  mscratch: number
  mepc: number
  mcause: number
  mtval: number
  satp: number
  priv: Priv
  scanY: number
  cycle: number
  halted: boolean
  haltReason: string
  fault: Fault | null
  lastAccess: Access | null
  trace: Trace | null
  history: string[]
  watts: number
  ratedWatts: number
  ramBytes: number
  pipeline: boolean
  bootDone: boolean
}

export type MachineConfig = {
  ramBytes: number
  ram?: Uint8Array
  fbWidth: number
  fbHeight: number
  gpuMode: 'text' | 'fb'
  scanHeight: number
  disk: Uint8Array
  rom: Uint8Array
  pc?: number
  watts: number
  ratedWatts: number
  pipeline: boolean
}

export function createMachine(cfg: MachineConfig): Machine {
  const ram = cfg.ram ?? new Uint8Array(cfg.ramBytes)
  return {
    pc: cfg.pc ?? 0,
    regs: Array.from({ length: 32 }, () => 0),
    ram,
    ramOwned: true,
    rom: cfg.rom,
    fb: new Uint8Array(cfg.fbWidth * cfg.fbHeight * 4),
    fbOwned: true,
    fbWidth: cfg.fbWidth,
    fbHeight: cfg.fbHeight,
    gpuMode: cfg.gpuMode,
    scanHeight: Math.max(1, cfg.scanHeight),
    text: '',
    kbdCode: 0,
    kbdReady: false,
    kbdIrq: false,
    lastKey: 0,
    mtime: 0,
    mtimecmp: 0,
    disk: cfg.disk,
    mstatus: 0,
    mie: 0,
    mtvec: 0,
    mscratch: 0,
    mepc: 0,
    mcause: 0,
    mtval: 0,
    satp: 0,
    priv: 'M',
    scanY: 0,
    cycle: 0,
    halted: false,
    haltReason: '',
    fault: null,
    lastAccess: null,
    trace: null,
    history: [],
    watts: cfg.watts,
    ratedWatts: cfg.ratedWatts,
    ramBytes: cfg.ramBytes,
    pipeline: cfg.pipeline,
    bootDone: (cfg.pc ?? 0) >= RAM_BASE,
  }
}

export function programMachine(
  code: Uint8Array,
  opts?: { ramBytes?: number; fbWidth?: number; fbHeight?: number },
): Machine {
  const ramBytes = opts?.ramBytes ?? 64 * 1024
  const ram = new Uint8Array(ramBytes)
  ram.set(code.subarray(0, Math.min(code.length, ramBytes)))
  const fbWidth = opts?.fbWidth ?? 0
  const fbHeight = opts?.fbHeight ?? 0
  return createMachine({
    ramBytes,
    ram,
    fbWidth,
    fbHeight,
    gpuMode: fbWidth ? 'fb' : 'text',
    scanHeight: fbHeight || 25,
    disk: new Uint8Array(0),
    rom: new Uint8Array(0),
    pc: RAM_BASE,
    watts: 87,
    ratedWatts: 300,
    pipeline: false,
  })
}

export type MapSeg = { name: string; start: number; end: number }

export function addressMap(m: Pick<Machine, 'ramBytes' | 'fbWidth' | 'fbHeight' | 'disk'>): MapSeg[] {
  const fbBytes = m.fbWidth * m.fbHeight * 4
  return [
    { name: '引导 ROM', start: BOOT_ROM_BASE, end: BOOT_ROM_BASE + BOOT_ROM_SIZE },
    { name: '定时器', start: TIMER_BASE, end: TIMER_BASE + 0x20 },
    { name: '串口', start: UART_BASE, end: UART_BASE + 0x20 },
    { name: '键盘', start: KBD_BASE, end: KBD_BASE + 0x20 },
    { name: '机器信息', start: INFO_BASE, end: INFO_BASE + 0x20 },
    { name: '显存', start: FB_BASE, end: FB_BASE + fbBytes },
    { name: '磁盘', start: DISK_BASE, end: DISK_BASE + m.disk.length },
    { name: '内存', start: RAM_BASE, end: RAM_BASE + m.ramBytes },
  ]
}

export function regionName(m: Pick<Machine, 'ramBytes' | 'fbWidth' | 'fbHeight' | 'disk'>, addr: number): string {
  const a = addr >>> 0
  for (const seg of addressMap(m)) {
    if (seg.end > seg.start && a >= seg.start && a < seg.end) return seg.name
  }
  return '未映射'
}
