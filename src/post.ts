import { type Assembly, type Loadout, resolve } from './catalog'
import { fmtBytes } from './spec'

export type PostId = 'power' | 'cpu' | 'ram' | 'video' | 'disk' | 'reset'

export type PostStep = {
  id: PostId
  title: string
  ok: boolean
  detail: string
}

function drawWatts(L: Loadout): number {
  return (L.cpu?.watts ?? 0) + (L.gpu?.watts ?? 0) + (L.ram?.watts ?? 0) + (L.disk?.watts ?? 0)
}

/** 按规格顺序检查。某一步失败就停，后面的步骤还没发生。 */
export function evaluatePost(slots: Assembly): PostStep[] {
  const L = resolve(slots)
  const steps: PostStep[] = []
  const watts = drawWatts(L)

  if (!L.psu) {
    steps.push({ id: 'power', title: '电源功率', ok: false, detail: '没有安装电源，机器没有供电。' })
    return steps
  }
  if (watts > L.psu.watts) {
    steps.push({
      id: 'power',
      title: '电源功率',
      ok: false,
      detail: `CPU + 显卡 + 内存 + 磁盘 = ${watts} W，电源额定 ${L.psu.watts} W，功率不够，CPU 不会复位。`,
    })
    return steps
  }
  steps.push({
    id: 'power',
    title: '电源功率',
    ok: true,
    detail: `合计 ${watts} W，电源额定 ${L.psu.watts} W。`,
  })

  if (!L.board) {
    steps.push({ id: 'cpu', title: 'CPU', ok: false, detail: '没有主板，CPU 接不进地址总线。' })
    return steps
  }
  if (!L.cpu) {
    steps.push({ id: 'cpu', title: 'CPU', ok: false, detail: 'CPU 插座是空的。' })
    return steps
  }
  steps.push({ id: 'cpu', title: 'CPU', ok: true, detail: `${L.cpu.name} 已装在 ${L.board.name} 上。` })

  if (!L.ram) {
    steps.push({ id: 'ram', title: '内存', ok: false, detail: '内存槽是空的，程序没有地方可放。' })
    return steps
  }
  steps.push({
    id: 'ram',
    title: '内存',
    ok: true,
    detail: `${L.ram.name}，容量 ${fmtBytes(L.ram.ramBytes ?? 0)}。`,
  })

  if (!L.gpu) {
    steps.push({ id: 'video', title: '显示输出', ok: false, detail: '没有显卡，显示器没有信号来源。' })
    return steps
  }
  if (!L.monitor) {
    steps.push({ id: 'video', title: '显示输出', ok: false, detail: '显示器线没有接上。' })
    return steps
  }
  if (L.gpu.mode !== L.monitor.mode) {
    const gpuKind = L.gpu.mode === 'text' ? '字符终端' : '帧缓冲'
    const monKind = L.monitor.mode === 'text' ? '字符信号' : '帧缓冲信号'
    steps.push({
      id: 'video',
      title: '显示输出',
      ok: false,
      detail: `显卡输出的是${gpuKind}，显示器要的是${monKind}。`,
    })
    return steps
  }
  if ((L.monitor.width ?? 0) > (L.gpu.width ?? 0) || (L.monitor.height ?? 0) > (L.gpu.height ?? 0)) {
    steps.push({
      id: 'video',
      title: '显示输出',
      ok: false,
      detail: `显示器分辨率 ${L.monitor.width}×${L.monitor.height} 超过显卡输出 ${L.gpu.width}×${L.gpu.height}。`,
    })
    return steps
  }
  steps.push({
    id: 'video',
    title: '显示输出',
    ok: true,
    detail: `${L.gpu.name} 接到 ${L.monitor.name}。`,
  })

  if (!L.disk) {
    steps.push({ id: 'disk', title: '启动盘', ok: false, detail: '没有磁盘，引导程序没有程序可装。' })
    return steps
  }
  steps.push({ id: 'disk', title: '启动盘', ok: true, detail: '虚拟磁盘已接入。' })
  steps.push({
    id: 'reset',
    title: 'CPU 复位',
    ok: true,
    detail: '程序计数器 = 0x00000000，指向引导 ROM。',
  })
  return steps
}

export function postPassed(steps: PostStep[]): boolean {
  return steps.length > 0 && steps.every((s) => s.ok) && steps[steps.length - 1].id === 'reset'
}
