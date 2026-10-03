import { type Assembly, type Part } from './catalog'
import type { Machine } from './sim/machine'
import { fmtBytes, hex } from './spec'

export function liveNow(part: Part, slots: Assembly, machine: Machine | null): string {
  const installed = slots[part.category] === part.id
  if (!installed) return '这颗零件现在没有装在机器上。'
  if (!machine) return '还没有复位。上电通过之后，这里显示当前这一拍。'
  if (part.category === 'psu') {
    return `额定 ${machine.ratedWatts} W，CPU、显卡、内存和磁盘合计 ${machine.watts} W。`
  }
  if (part.category === 'cpu') {
    const t = machine.trace
    const head = part.pipeline
      ? '这颗 CPU 的规格是五级流水线。当前仿真仍按单周期退休一条指令，同一套系统可以启动。停顿和转发留在加深阶段。'
      : '这一拍同时做完取指、译码、执行和写回。'
    if (!t) return `${head} 程序计数器 ${hex(machine.pc)}。`
    const regs = `相关寄存器 ${nameOf(t.rs1)}=${hex(t.rs1v)}，${nameOf(t.rs2)}=${hex(t.rs2v)}。ALU ${hex(t.alu)}。`
    const mem = t.memAddr !== null ? `访存地址 ${hex(t.memAddr)}。` : '这一拍没有数据访存。'
    const trap = t.trap ? `事件：${t.trap}。` : ''
    return `${head} 程序计数器 ${hex(t.pc)}，指令 ${t.asm}。${regs}${mem}下一地址 ${hex(t.nextPc)}。${trap}`
  }
  if (part.category === 'ram') {
    const addr = machine.fault
      ? machine.fault.va
      : machine.trace?.memAddr ?? machine.lastAccess?.addr
    const where = addr === undefined ? '这一拍还没有访问内存。' : `本拍地址 ${hex(addr)}，落到${machine.lastAccess?.region ?? '未映射'}。`
    const fault = machine.fault
      ? ` 翻译失败：第 ${machine.fault.level} 级页表项在 ${hex(machine.fault.pteAddr)}，内容 ${hex(machine.fault.pte)}，访问类型是${machine.fault.access}。`
      : ''
    return `容量 ${fmtBytes(machine.ramBytes)}。${where}${fault}`
  }
  if (part.category === 'gpu') {
    const mode = machine.gpuMode === 'text' ? '字符终端' : `帧缓冲 ${machine.fbWidth}×${machine.fbHeight}`
    return `输出模式是${mode}。正在扫描第 ${machine.scanY} 行。`
  }
  if (part.category === 'monitor') {
    if (machine.gpuMode === 'text') return `屏幕上是显卡送来的字符。终端目前有 ${machine.text.length} 个字符。`
    return `屏幕上是显卡扫出的 ${machine.fbWidth}×${machine.fbHeight} 画面，扫描到第 ${machine.scanY} 行。`
  }
  if (part.category === 'keyboard') {
    const key = machine.lastKey ? `${machine.lastKey}（${String.fromCharCode(machine.lastKey)}）` : '还没有'
    return `最近一次扫描码 ${key}。数据寄存器${machine.kbdReady ? '里还有未读按键' : '是空的'}。中断线${machine.kbdIrq ? '已置位' : '没有置位'}。`
  }
  if (part.category === 'disk') {
    return `镜像 ${machine.disk.length} 字节。${machine.bootDone ? '引导程序已经把控制权交给内存里的程序。' : '引导程序还在读盘或尚未跳转。'}`
  }
  const beat = machine.lastAccess
  return beat
    ? `本拍访问 ${hex(beat.addr)}，落在${beat.region}，${beat.write ? '写' : '读'} ${beat.size} 字节。`
    : '本拍还没有总线访问。'
}

function nameOf(n: number): string {
  const names = ['zero', 'ra', 'sp', 'gp', 'tp', 't0', 't1', 't2', 's0', 's1', 'a0', 'a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 's2', 's3', 's4', 's5', 's6', 's7', 's8', 's9', 's10', 's11', 't3', 't4', 't5', 't6']
  return names[n] ?? `x${n}`
}
