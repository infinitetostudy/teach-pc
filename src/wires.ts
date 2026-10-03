import type { SlotId } from './catalog'
import type { Machine } from './sim/machine'
import { DISK_BASE, RAM_BASE, hex } from './spec'

export type WireId = 'power' | 'cpu' | 'ram' | 'gpu' | 'video' | 'disk' | 'keyboard'

export type Wire = {
  id: WireId
  from: SlotId
  to: SlotId
  name: string
  signal: string
  principle: string
}

/** 教学机上真实存在的连接。地址都按规格里的译码，不另造一条总线。 */
export const WIRES: Wire[] = [
  {
    id: 'power',
    from: 'psu',
    to: 'board',
    name: '供电线',
    signal: '只送功率，不送地址',
    principle:
      '电源不出现在地址空间里。上电时把 CPU、显卡、内存、磁盘的功耗加起来，不超过额定功率才允许复位。通过之后，主板把电分到 CPU 插座、内存槽、显卡槽和磁盘。功率不够就停在这一步，CPU 不会取指。',
  },
  {
    id: 'cpu',
    from: 'cpu',
    to: 'board',
    name: 'CPU 总线',
    signal: '地址、数据、读/写',
    principle:
      'CPU 自己不认识内存条或显卡。它只把地址和读写要求交给主板。每一拍取指至少走一次：程序计数器里的地址出去，32 位指令回到指令寄存器。数据访问再走一次，主板按高位决定落到哪一段。',
  },
  {
    id: 'ram',
    from: 'ram',
    to: 'board',
    name: '内存总线',
    signal: '0x80000000 起',
    principle:
      '地址落在 0x80000000 以上时，主板减去这个基址，得到内存条内部的偏移。内核、页表和线程控制块都放在这里。偏移超过这根内存条的容量，这一拍就是越界。取指和 lw/sw 共用这条线，内存不区分指令和数据。',
  },
  {
    id: 'gpu',
    from: 'gpu',
    to: 'board',
    name: '显卡槽',
    signal: '串口、机器信息、显存',
    principle:
      '显卡带自己的存储器，不占用内存条。CPU 用 sw 写 0x10001000，字节进字符缓冲；写 0x10010000 起的地址，就是在写像素。0x10003000 是只读的机器信息，引导程序从这里知道内存有多大、帧缓冲有多宽。',
  },
  {
    id: 'video',
    from: 'gpu',
    to: 'monitor',
    name: '视频线',
    signal: '扫描好的画面',
    principle:
      '显示器不接 CPU，只接显卡。显卡每个时钟把下一行扫出去。CPU 用 sw 写的是显存，屏幕上看到的是显卡已经扫出来的结果。分辨率高于显卡输出时，这根线在上电阶段就接不上。',
  },
  {
    id: 'disk',
    from: 'disk',
    to: 'board',
    name: '磁盘线',
    signal: '0x40000000 起只读',
    principle:
      '磁盘内容映射成一块只读窗口。开头 16 字节是魔数 0x54454348、装入地址和长度，后面才是程序。引导 ROM 用普通的 lw 把它们读进来。操作系统并不拨磁盘的针脚，它只是在访问这段地址。',
  },
  {
    id: 'keyboard',
    from: 'keyboard',
    to: 'board',
    name: '键盘线',
    signal: '扫描码和中断',
    principle:
      '键帽下面的矩阵在键盘里编成扫描码，送到主板的键盘控制器，放进 0x10002000，并把中断线拉高。CPU 不直接扫描行列。程序读走数据寄存器后，这一次请求才撤掉。',
  },
]

const REGION_WIRE: Record<string, WireId> = {
  内存: 'ram',
  显存: 'gpu',
  串口: 'gpu',
  机器信息: 'gpu',
  磁盘: 'disk',
  键盘: 'keyboard',
  定时器: 'cpu',
  '引导 ROM': 'cpu',
}

export function activeWireIds(machine: Machine | null): WireId[] {
  if (!machine) return []
  const ids = new Set<WireId>(['cpu'])
  const region = machine.fault ? '内存' : machine.lastAccess?.region
  if (region && REGION_WIRE[region]) ids.add(REGION_WIRE[region])
  if (region === '显存' || region === '串口') ids.add('video')
  if (machine.kbdIrq || machine.kbdReady || region === '键盘') ids.add('keyboard')
  if (machine.trace?.trap === '定时器中断') ids.add('cpu')
  return [...ids]
}

export function slotsOnWires(ids: WireId[]): SlotId[] {
  const slots = new Set<SlotId>()
  for (const wire of WIRES) {
    if (!ids.includes(wire.id)) continue
    slots.add(wire.from)
    slots.add(wire.to)
  }
  return [...slots]
}

export function pathSentence(machine: Machine | null): string {
  if (!machine) return '还没有总线周期。上电复位之后，第一拍取指会从 CPU 经主板进入引导 ROM。'
  if (machine.fault) {
    const unmapped = (machine.fault.pte & 1) === 0
    const why = unmapped ? '有效位是 0，这一级没有映射。' : '页表项有效，但权限不够这次访问。'
    return `CPU 发出虚地址 ${hex(machine.fault.va)}。主板先按 satp 到内存里查第 ${machine.fault.level} 级页表，项在 ${hex(machine.fault.pteAddr)}，内容 ${hex(machine.fault.pte)}。${why}这一拍不退休。`
  }
  const access = machine.lastAccess
  const fetchOnly = machine.trace?.memAddr == null
  if (fetchOnly && access?.region === '引导 ROM') {
    return `取指地址 ${hex(access.addr)} 从 CPU 进入主板，译到引导 ROM，读回指令。引导程序固化在主板上，这一拍不经过磁盘线。`
  }
  if (fetchOnly && access?.region === '内存') {
    return `取指地址 ${hex(access.addr)} 从 CPU 进入主板，经内存总线落到内存，条内偏移 ${hex((access.addr - RAM_BASE) >>> 0)}，读回指令。`
  }
  const fetch = `取指地址 ${hex(machine.pc)} 从 CPU 进入主板。`
  if (!access) return fetch
  if (access.region === '引导 ROM') {
    return `${fetch}主板把它译到引导 ROM，读回这条指令。引导程序固化在主板上，不经过磁盘线。`
  }
  if (access.region === '定时器') {
    return `${fetch}数据地址 ${hex(access.addr)} 落在主板内部的定时器，不经过内存槽或显卡槽。mtime 每个时钟加一，mtimecmp 到点就把中断线拉高。`
  }
  const wire = WIRES.find((item) => item.id === REGION_WIRE[access.region])
  const where = wire ? `经${wire.name}` : '译码后'
  const action = access.write ? '写入' : '读出'
  const offset = access.region === '内存' ? `，条内偏移 ${hex((access.addr - RAM_BASE) >>> 0)}` : ''
  const diskOff = access.region === '磁盘' ? `，窗口偏移 ${hex((access.addr - DISK_BASE) >>> 0)}` : ''
  return `${fetch}这一拍的数据地址 ${hex(access.addr)} ${where}落到${access.region}${offset}${diskOff}，${action} ${access.size} 字节。`
}
