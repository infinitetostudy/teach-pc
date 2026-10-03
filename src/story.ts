import type { Machine } from './sim/machine'
import { KMEM, RAM_BASE, hex } from './spec'
import type { DiskKind } from './presets'

export type ImageKind = DiskKind | 'custom'

export type StoryStep = {
  title: string
  detail: string
  state: 'done' | 'now' | 'wait'
}

function word(machine: Machine, addr: number): number {
  const off = addr - RAM_BASE
  if (off < 0 || off + 4 > machine.ram.length) return 0
  const bytes = machine.ram
  return (bytes[off] | (bytes[off + 1] << 8) | (bytes[off + 2] << 16) | (bytes[off + 3] << 24)) >>> 0
}

const BOOT: StoryStep[] = [
  {
    title: '复位，从引导 ROM 取指',
    detail:
      '复位把特权留在机器态，中断关掉，程序计数器写成 0x00000000。引导程序做在主板上的 ROM 里，所以第一拍取指不经过磁盘，也不经过内存条。ROM 只读，程序不能改掉引导过程。',
    state: 'wait',
  },
  {
    title: '读磁盘头',
    detail:
      '引导程序把 0x40000000 的第一个字读进来，必须等于魔数 0x54454348。接着读长度和装入地址。魔数不对就 ebreak，避免把一段无关数据当成指令执行。',
    state: 'wait',
  },
  {
    title: '核对内存并试写',
    detail:
      '长度要和 0x10003000 上的内存容量比较。容量更小，就往串口写 MEM 并停机，CPU 不会跳进一个装不下的程序。容量够的话，再向装入地址写 0x12345000 并读回，确认这根内存条可写。',
    state: 'wait',
  },
  {
    title: '抄进内存并跳过去',
    detail:
      '从磁盘窗口偏移 16 开始，每次 lw 四个字节，再 sw 到内存。长度减到 0 之后，jalr 到装入地址，通常是 0x80000000。从下一拍起，取指落在内存总线上，引导 ROM 不再被执行。',
    state: 'wait',
  },
]

const KERNEL: StoryStep[] = [
  {
    title: '内核设置栈和陷入入口',
    detail:
      '内核第一条把 sp 指到内存里的栈。随后把 trap 的地址写入 mtvec，把 mscratch 指到一块草稿。没有 mtvec，ecall 和定时器都不知道跳去哪里。mscratch 用来在陷入的第一拍换出 a0，这样保存现场时不会先冲掉原来的参数。',
    state: 'wait',
  },
  {
    title: 'ecall 把字符交给串口',
    detail:
      'ecall 是同步陷入。机器态的 mcause 是 11。硬件把当前 PC 留在 mepc，关掉中断，跳到 mtvec。处理程序看到 a7 等于 1，就按 a0 指向的字符串逐字节 sw 到 0x10001000。然后把 mepc 加 4，mret 回到 ecall 的下一条。打印不是一条特殊指令，是对串口寄存器的存储。',
    state: 'wait',
  },
  {
    title: '打开定时器，进入用户线程',
    detail:
      '两个线程的入口和栈先写进各自的 TCB。mtimecmp 设成当前 mtime 加 200，mie 的第 7 位打开定时器，mstatus 的 MPIE 打开。mret 时硬件把 MPIE 复制到 MIE，特权改成 MPP。这里 MPP 是用户态，所以线程开始跑，并且定时器可以再把它打断。',
    state: 'wait',
  },
  {
    title: '中断里保存寄存器并换线程',
    detail:
      'mtime 达到 mtimecmp 时，这一拍不执行原来的指令。mepc 记下令被打断的 PC，mcause 写成 0x80000007，转到 trap。处理程序把寄存器和 mepc 存进当前 TCB，ticks 加一，换到另一个 TCB，再把寄存器装回去，mret。两个循环能接着跑，是因为寄存器被保存过，不是因为内存里有两份 CPU。',
    state: 'wait',
  },
]

const PAGE: StoryStep = {
  title: '打开页表，翻译失败就停住',
  detail:
    '程序先在物理内存里清出根页表，写上两张恒等映射的 4MiB 大页，再把 satp 最高位置 1。之后取指和 lw/sw 都要先查页表。0x80000000 和 0x10000000 能通过，0x90000000 的一级页表项有效位是 0。翻译失败时指令不退休，程序计数器停在这一拍。',
  state: 'wait',
}

const USER: StoryStep = {
  title: '内存里的程序自己访问设备',
  detail:
    '跳转之后，取指已经在内存总线上。程序再用 sw 写串口、写显存或读键盘，走的仍是主板译码，不是一条新的操作系统接口。没有 ecall 和 mtvec 时，CPU 不会自己换线程，也不会把按键变成函数调用。',
  state: 'wait',
}

function bootIndex(machine: Machine): number {
  if (machine.haltReason.includes('魔数')) return 1
  if (machine.haltReason.includes('内存') || machine.text.includes('MEM')) return 2
  const region = machine.lastAccess?.region
  const addr = machine.lastAccess?.addr ?? 0
  if (machine.trace?.asm.startsWith('jalr')) return 3
  if (region === '磁盘') return addr - 0x40000000 >= 16 ? 3 : 1
  if (region === '机器信息' || region === '内存' || region === '串口') return 2
  return 0
}

function kernelIndex(machine: Machine): number {
  const ticks = word(machine, KMEM.ticks)
  const trap = machine.trace?.trap ?? ''
  const asm = machine.trace?.asm ?? ''
  if (trap === '定时器中断' || asm === '定时器中断') return 7
  if (machine.priv === 'U') return 6
  if (trap === 'ecall' || asm === 'ecall') return 5
  if (machine.text.includes('HI')) {
    if (ticks > 0 && machine.priv === 'M') return 7
    if (ticks > 0 || machine.lastAccess?.region === '定时器' || asm.startsWith('mret')) return 6
    return 5
  }
  return 4
}

function mark(steps: StoryStep[], current: number): StoryStep[] {
  return steps.map((step, index) => ({
    ...step,
    state: index === current ? 'now' : index < current ? 'done' : 'wait',
  }))
}

export function controlStory(machine: Machine | null, kind: ImageKind): StoryStep[] {
  const page = kind === 'page'
  const kernel = kind === 'kernel'
  const steps: StoryStep[] = [...BOOT]
  if (!kernel && !page) steps.push({ ...USER })
  if (kernel) steps.push(...KERNEL.map((step) => ({ ...step })))
  if (page) steps.push({ ...PAGE })
  if (!machine) return steps.map((step) => ({ ...step, state: 'wait' }))

  const haltedEarly = machine.haltReason.includes('内存') || machine.haltReason.includes('魔数')
  let current = bootIndex(machine)
  const inRam = machine.bootDone || machine.pc >= RAM_BASE
  if (inRam && !haltedEarly) {
    if (page) current = machine.fault || (machine.satp >>> 31) === 1 ? steps.length - 1 : 4
    else if (kernel) current = kernelIndex(machine)
    else current = 4
  }
  if (machine.fault) current = steps.length - 1
  const marked = mark(steps, Math.min(current, steps.length - 1))
  if (kernel && word(machine, KMEM.ticks) > 0) {
    const interrupt = marked.find((step) => step.title.startsWith('中断'))
    if (interrupt && interrupt.state === 'wait') interrupt.state = 'done'
  }
  return marked
}

export function nowDetail(steps: StoryStep[]): string {
  return steps.find((step) => step.state === 'now')?.detail ?? '上电并复位之后，这里会跟着程序计数器说明操作系统正在哪一步控制硬件。'
}

export function pcLine(machine: Machine | null): string {
  if (!machine) return 'CPU 还没有复位。'
  const trap = machine.trace?.trap ? `，事件 ${machine.trace.trap}` : ''
  return `PC ${hex(machine.pc)}，${machine.priv} 态${trap}${machine.halted ? `，已停：${machine.haltReason}` : ''}`
}
