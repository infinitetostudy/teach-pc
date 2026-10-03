export type Category =
  | 'board'
  | 'cpu'
  | 'ram'
  | 'gpu'
  | 'psu'
  | 'monitor'
  | 'keyboard'
  | 'disk'

const art = (file: string) => `${import.meta.env.BASE_URL}parts/${file}`

export const PART_ART: Record<Category, string> = {
  board: art('board.jpg'),
  cpu: art('cpu.jpg'),
  ram: art('ram.jpg'),
  gpu: art('gpu.jpg'),
  psu: art('psu.jpg'),
  monitor: art('monitor.jpg'),
  keyboard: art('keyboard.jpg'),
  disk: art('disk.jpg'),
}

export type VideoMode = 'text' | 'fb'

export type Part = {
  id: string
  name: string
  category: Category
  slot: string
  watts: number
  ramBytes?: number
  width?: number
  height?: number
  mode?: VideoMode
  pipeline?: boolean
  role: string
  principle: string
  links: string
}

export const SLOTS = [
  { id: 'board', title: '主板', hint: '地址译码与插座' },
  { id: 'cpu', title: 'CPU 插座', hint: 'RV32I' },
  { id: 'ram', title: '内存槽', hint: '内核装在这里' },
  { id: 'gpu', title: '显卡槽', hint: '显示控制器' },
  { id: 'psu', title: '电源', hint: '功率要盖住整机' },
  { id: 'disk', title: '磁盘', hint: '启动镜像' },
  { id: 'monitor', title: '显示器线', hint: '只显示显卡的输出' },
  { id: 'keyboard', title: '键盘线', hint: '扫描码进设备寄存器' },
] as const

export type SlotId = (typeof SLOTS)[number]['id']

export type Assembly = Partial<Record<SlotId, string>>

const board = (p: Part) => p
const cpu = (p: Part) => p

export const PARTS: Part[] = [
  board({
    id: 'board-rv32',
    name: 'RV32 主板',
    category: 'board',
    slot: 'board',
    watts: 0,
    role: '把 CPU 发出的地址分到引导 ROM、内存、显存或某一件设备。主板自己不执行指令。',
    principle:
      '地址译码器看高位。0x00000000 落到引导 ROM，0x80000000 落到内存条，0x10000000 一带落到定时器、串口、键盘和显存，0x40000000 落到磁盘窗口。换内存条或显卡，只改变对应那段的长度，分段方式不变。',
    links: '上接 CPU 的地址总线和数据总线，下接内存槽、显卡槽和板上的设备控制器。',
  }),
  cpu({
    id: 'cpu-single',
    name: '单周期 RV32I',
    category: 'cpu',
    slot: 'cpu',
    watts: 65,
    pipeline: false,
    role: '一个时钟完成取指、译码、执行和写回。程序计数器里放的是下一条指令的地址。',
    principle:
      '取指从程序计数器读 32 位指令。译码拆出寄存器号、立即数和操作。ALU 做运算或算访存地址。需要时读写内存或设备，最后把结果写回寄存器堆。x0 永远是 0。',
    links: '地址线进主板译码，数据来回于寄存器堆、内存和设备。复位后程序计数器指向引导 ROM。',
  }),
  cpu({
    id: 'cpu-pipe',
    name: '五级流水线 RV32I',
    category: 'cpu',
    slot: 'cpu',
    watts: 95,
    pipeline: true,
    role: '同一套 RV32I 指令，设想分成取指、译码、执行、访存、写回五级。换上它不改变已经写好的系统。',
    principle:
      '理想情况下每一级同时处理不同指令。上一条还在写回时，下一条已经在取指。装入指令的结果若马上被下一条使用，需要停顿或转发；分支在执行级才知道去向，前面取错的指令要丢掉。',
    links: '对外仍是同一组地址总线和数据总线，主板和操作系统不用改。',
  }),
  {
    id: 'ram-64',
    name: '内存 64 KiB',
    category: 'ram',
    slot: 'ram',
    watts: 4,
    ramBytes: 64 * 1024,
    role: '存放引导程序从磁盘搬来的程序。容量不够，程序就装不进来。',
    principle:
      'CPU 发出的地址减去 0x80000000，就是这根内存条内部的偏移。偏移超出容量，这一拍访问失败。内存不区分指令和数据，取指和 lw/sw 走同一条译码路径。',
    links: '插在主板内存槽上，占用地址 0x80000000 起的一段。',
  },
  {
    id: 'ram-256',
    name: '内存 256 KiB',
    category: 'ram',
    slot: 'ram',
    watts: 8,
    ramBytes: 256 * 1024,
    role: '存放引导程序从磁盘搬来的程序。容量不够，程序就装不进来。',
    principle:
      'CPU 发出的地址减去 0x80000000，就是这根内存条内部的偏移。偏移超出容量，这一拍访问失败。内存不区分指令和数据，取指和 lw/sw 走同一条译码路径。',
    links: '插在主板内存槽上，占用地址 0x80000000 起的一段。',
  },
  {
    id: 'ram-1024',
    name: '内存 1 MiB',
    category: 'ram',
    slot: 'ram',
    watts: 12,
    ramBytes: 1024 * 1024,
    role: '存放引导程序从磁盘搬来的程序。容量不够，程序就装不进来。',
    principle:
      'CPU 发出的地址减去 0x80000000，就是这根内存条内部的偏移。偏移超出容量，这一拍访问失败。内存不区分指令和数据，取指和 lw/sw 走同一条译码路径。',
    links: '插在主板内存槽上，占用地址 0x80000000 起的一段。',
  },
  {
    id: 'gpu-text',
    name: '字符终端显卡',
    category: 'gpu',
    slot: 'gpu',
    watts: 10,
    width: 80,
    height: 25,
    mode: 'text',
    role: '把 CPU 写到串口的字符收成一屏文字。它没有像素帧缓冲。',
    principle:
      'CPU 用 sw 把一个字节写到 0x10001000，显卡把这个字节放进字符缓冲，并按行扫描送到显示器。字符终端不是帧缓冲，不能用它画像素。',
    links: '插在显卡槽，字符缓冲挂在串口地址，输出接显示器线。',
  },
  {
    id: 'gpu-320',
    name: '帧缓冲显卡 320×240',
    category: 'gpu',
    slot: 'gpu',
    watts: 40,
    width: 320,
    height: 240,
    mode: 'fb',
    role: '自己带一块显存。CPU 用 sw 写像素，显卡按节拍把显存扫到显示器。',
    principle:
      '显卡是一块带自己存储器的显示控制器。显存从 0x10010000 开始，每个像素 4 字节。扫描行每个时钟往下走一行，走完再回到第 0 行。CPU 不直接驱动显示器。',
    links: '显存映射在设备地址空间，视频线接显示器。',
  },
  {
    id: 'gpu-640',
    name: '帧缓冲显卡 640×480',
    category: 'gpu',
    slot: 'gpu',
    watts: 80,
    width: 640,
    height: 480,
    mode: 'fb',
    role: '自己带一块显存。CPU 用 sw 写像素，显卡按节拍把显存扫到显示器。',
    principle:
      '显卡是一块带自己存储器的显示控制器。显存从 0x10010000 开始，每个像素 4 字节。分辨率比 320×240 那张卡更高，所以同一段写像素的程序能多画一块屏幕。',
    links: '显存映射在设备地址空间，视频线接显示器。',
  },
  {
    id: 'psu-150',
    name: '电源 150 W',
    category: 'psu',
    slot: 'psu',
    watts: 150,
    role: '给 CPU、显卡、内存和磁盘供电。合计功耗超过额定功率，机器停在上电，不会取指。',
    principle:
      '上电时把 CPU、显卡、内存、磁盘的功耗加在一起，和电源额定功率比较。电源不参与地址译码，也不执行指令。',
    links: '供电线接到主板，再分给插座上的零件。',
  },
  {
    id: 'psu-300',
    name: '电源 300 W',
    category: 'psu',
    slot: 'psu',
    watts: 300,
    role: '给 CPU、显卡、内存和磁盘供电。合计功耗超过额定功率，机器停在上电，不会取指。',
    principle:
      '上电时把 CPU、显卡、内存、磁盘的功耗加在一起，和电源额定功率比较。电源不参与地址译码，也不执行指令。',
    links: '供电线接到主板，再分给插座上的零件。',
  },
  {
    id: 'psu-500',
    name: '电源 500 W',
    category: 'psu',
    slot: 'psu',
    watts: 500,
    role: '给 CPU、显卡、内存和磁盘供电。合计功耗超过额定功率，机器停在上电，不会取指。',
    principle:
      '上电时把 CPU、显卡、内存、磁盘的功耗加在一起，和电源额定功率比较。电源不参与地址译码，也不执行指令。',
    links: '供电线接到主板，再分给插座上的零件。',
  },
  {
    id: 'mon-text',
    name: '字符显示器 80×25',
    category: 'monitor',
    slot: 'monitor',
    watts: 0,
    width: 80,
    height: 25,
    mode: 'text',
    role: '只显示显卡扫出来的字符。它自己不存画面。',
    principle:
      '显示器收到的是显卡已经扫好的信号。分辨率或信号模式超过显卡输出时，上电阶段就失败，屏幕保持无信号。',
    links: '视频线接在显卡上，不直接接 CPU。',
  },
  {
    id: 'mon-320',
    name: '显示器 320×240',
    category: 'monitor',
    slot: 'monitor',
    watts: 0,
    width: 320,
    height: 240,
    mode: 'fb',
    role: '只显示显卡扫出来的画面。它自己不存像素。',
    principle:
      '显示器收到的是显卡已经扫好的信号。分辨率高于显卡输出时，上电阶段就失败。',
    links: '视频线接在显卡上，不直接接 CPU。',
  },
  {
    id: 'mon-640',
    name: '显示器 640×480',
    category: 'monitor',
    slot: 'monitor',
    watts: 0,
    width: 640,
    height: 480,
    mode: 'fb',
    role: '只显示显卡扫出来的画面。它自己不存像素。',
    principle:
      '显示器收到的是显卡已经扫好的信号。若显卡只能输出 320×240，这台显示器在上电时会被拒绝。',
    links: '视频线接在显卡上，不直接接 CPU。',
  },
  {
    id: 'kbd-matrix',
    name: '矩阵键盘',
    category: 'keyboard',
    slot: 'keyboard',
    watts: 0,
    role: '把一次按键变成扫描码，放进键盘控制器，并挂起中断线。',
    principle:
      '键帽下面是行列矩阵。控制器扫描哪一行哪一列导通，编成扫描码，写到 0x10002000 的数据寄存器，并把状态位和中断请求置上。CPU 读走扫描码后，这一次请求撤掉。',
    links: '键盘线接主板的键盘控制器，不直接接 CPU 引脚。',
  },
  {
    id: 'disk-virt',
    name: '虚拟磁盘',
    category: 'disk',
    slot: 'disk',
    watts: 10,
    role: '保存要启动的程序。引导 ROM 只读它的第一段，装进内存再跳过去。',
    principle:
      '磁盘内容映射在 0x40000000 的只读窗口。开头 16 字节是魔数、装入地址和长度，后面是程序本体。引导程序用 lw 把这一段抄到 0x80000000。',
    links: '接在主板的磁盘控制器上。CPU 不直接认识文件系统。',
  },
]

const byId = new Map(PARTS.map((p) => [p.id, p]))

export function partById(id: string | undefined): Part | undefined {
  if (!id) return undefined
  return byId.get(id)
}

export type Loadout = {
  board?: Part
  cpu?: Part
  ram?: Part
  gpu?: Part
  psu?: Part
  monitor?: Part
  keyboard?: Part
  disk?: Part
}

export function resolve(slots: Assembly): Loadout {
  return {
    board: partById(slots.board),
    cpu: partById(slots.cpu),
    ram: partById(slots.ram),
    gpu: partById(slots.gpu),
    psu: partById(slots.psu),
    monitor: partById(slots.monitor),
    keyboard: partById(slots.keyboard),
    disk: partById(slots.disk),
  }
}

/** 不启动仿真，只根据已装零件算功耗、内存和分辨率。 */
export function summarize(slots: Assembly): {
  watts: number
  psuWatts: number
  ramBytes: number
  video: string
  lines: string[]
} {
  const L = resolve(slots)
  const draw = [L.cpu, L.gpu, L.ram, L.disk]
  const watts = draw.reduce((s, p) => s + (p?.watts ?? 0), 0)
  const video = L.gpu
    ? L.gpu.mode === 'text'
      ? `字符 ${L.gpu.width}×${L.gpu.height}`
      : `${L.gpu.width}×${L.gpu.height}`
    : '无显卡'
  const lines = SLOTS.map((slot) => {
    const p = partById(slots[slot.id])
    return `${slot.title}：${p ? p.name : '空'}`
  })
  return {
    watts,
    psuWatts: L.psu?.watts ?? 0,
    ramBytes: L.ram?.ramBytes ?? 0,
    video,
    lines,
  }
}

export function slotForCategory(category: Category): SlotId {
  return category
}
