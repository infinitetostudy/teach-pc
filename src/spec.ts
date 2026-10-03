/** 教学机规格。零件、仿真和操作系统都按这里对齐。 */

export const ISA = 'RV32I'

/** 入门数据通路先讲清的指令。操作系统还会用到移位、比较、ecall、CSR 和 mret。 */
export const INTRO_OPCODES = [
  'add',
  'addi',
  'sub',
  'and',
  'andi',
  'or',
  'ori',
  'xor',
  'sll',
  'lw',
  'sw',
  'beq',
  'jal',
  'jalr',
  'lui',
] as const

export const BOOT_ROM_BASE = 0x00000000
export const BOOT_ROM_SIZE = 0x1000

export const TIMER_BASE = 0x10000000
export const UART_BASE = 0x10001000
export const KBD_BASE = 0x10002000
export const INFO_BASE = 0x10003000
export const FB_BASE = 0x10010000
export const DISK_BASE = 0x40000000
export const RAM_BASE = 0x80000000

export const DISK_MAGIC = 0x54454348

/** 内核固定使用的内存单元，界面直接读这些地址。 */
export const KMEM = {
  ticks: 0x80008000,
  current: 0x80008004,
  sig0: 0x80008008,
  sig1: 0x8000800c,
} as const

export const POWER_ON_ORDER = [
  '电源功率是否盖住 CPU、显卡、内存和磁盘',
  'CPU 是否装在主板上',
  '内存条是否在位',
  '显卡与显示器是否接得上',
  '启动盘是否在位',
  'CPU 复位，程序计数器指向引导 ROM',
] as const

export type RegionName =
  | '引导 ROM'
  | '定时器'
  | '串口'
  | '键盘'
  | '机器信息'
  | '显存'
  | '磁盘'
  | '内存'
  | '未映射'

export function hex(n: number, width = 8): string {
  return `0x${(n >>> 0).toString(16).padStart(width, '0')}`
}

export function fmtBytes(n: number): string {
  if (n >= 1024 * 1024 && n % (1024 * 1024) === 0) return `${n / (1024 * 1024)} MiB`
  if (n >= 1024 && n % 1024 === 0) return `${n / 1024} KiB`
  return `${n} B`
}
