import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { KMEM, RAM_BASE } from '../src/spec.ts'
import { assemble } from '../src/sim/asm.ts'
import { buildMachine } from '../src/sim/build.ts'
import { pressKey, runSteps, step } from '../src/sim/cpu.ts'
import {
  KERNEL_LOAD_SIZE,
  KEY_SRC,
  OK_SRC,
  PIXEL_SRC,
  bootRom,
  kernelDisk,
  makeDisk,
} from '../src/sim/images.ts'
import { programMachine, type Machine } from '../src/sim/machine.ts'
import { evaluatePost } from '../src/post.ts'

const root = resolve(import.meta.dirname, '..')
const bootSrc = readFileSync(resolve(root, 'src/firmware/boot.S'), 'utf8')
const kernelSrc = readFileSync(resolve(root, 'src/firmware/kernel.S'), 'utf8')
const pageSrc = readFileSync(resolve(root, 'src/firmware/pagefault.S'), 'utf8')
const rom = bootRom(bootSrc)

let failed = 0
function check(name: string, cond: boolean, extra = '') {
  if (cond) {
    console.log(`ok  ${name}`)
  } else {
    failed += 1
    console.log(`FAIL ${name} ${extra}`)
  }
}

function word(m: Machine, addr: number): number {
  const off = (addr - RAM_BASE) >>> 0
  const b = m.ram
  return (b[off] | (b[off + 1] << 8) | (b[off + 2] << 16) | (b[off + 3] << 24)) >>> 0
}

function dump(m: Machine) {
  return `pc=${(m.pc >>> 0).toString(16)} halt=${m.haltReason} text=${JSON.stringify(m.text)} fault=${m.fault ? (m.fault.va >>> 0).toString(16) : ''} hist=${m.history.slice(-12).join(' | ')}`
}

const addi = assemble(`
    addi a0, zero, 7
    addi a1, a0, 3
    ebreak
`, RAM_BASE)
let m = runSteps(programMachine(addi.bytes), 10)
check('addi 得到 7 和 10', (m.regs[10] | 0) === 7 && (m.regs[11] | 0) === 10, dump(m))

const jump = assemble(`
    jal zero, skip
    addi a0, zero, 1
skip:
    addi a0, zero, 2
    ebreak
`, RAM_BASE)
m = runSteps(programMachine(jump.bytes), 10)
check('jal 跳过中间指令', (m.regs[10] | 0) === 2, dump(m))

const mem = assemble(`
    lui t0, 0x80001
    addi t1, zero, 42
    sw t1, 0(t0)
    lw t2, 0(t0)
    ebreak
`, RAM_BASE)
m = runSteps(programMachine(mem.bytes), 20)
check('sw/lw 往返', (m.regs[7] | 0) === 42, dump(m))

function teach(ram: string, extra: Partial<Record<string, string>> = {}) {
  return {
    board: 'board-rv32',
    cpu: 'cpu-single',
    ram,
    gpu: 'gpu-text',
    psu: 'psu-300',
    disk: 'disk-virt',
    monitor: 'mon-text',
    keyboard: 'kbd-matrix',
    ...extra,
  }
}

const okDisk = makeDisk(assemble(OK_SRC, RAM_BASE).bytes)
let machine = buildMachine(teach('ram-256'), okDisk, rom)
if (!machine) throw new Error('推荐配置没有通过自检')
machine = runSteps(machine, 5000)
check('引导后终端出现 OK', machine.text.includes('OK') && machine.bootDone, dump(machine))
check('程序计数器已离开引导 ROM', machine.pc >= RAM_BASE, dump(machine))

const tiny = buildMachine(teach('ram-64'), kernelDisk(kernelSrc), rom)
if (!tiny) throw new Error('小内存配置没有通过自检')
const tinyRan = runSteps(tiny, 200)
check('64KiB 装不下内核', tinyRan.halted && tinyRan.haltReason.includes('内存') && tinyRan.text.includes('MEM'), dump(tinyRan))

const pixels = makeDisk(assemble(PIXEL_SRC, RAM_BASE).bytes)
let px = buildMachine(
  teach('ram-256', { gpu: 'gpu-320', monitor: 'mon-320' }),
  pixels,
  rom,
)
if (!px) throw new Error('像素机没有通过自检')
px = runSteps(px, 8000)
let painted = 0
for (let y = 0; y < 16; y++) {
  for (let x = 0; x < 16; x++) {
    const off = (y * px.fbWidth + x) * 4
    const color = (px.fb[off] | (px.fb[off + 1] << 8) | (px.fb[off + 2] << 16) | (px.fb[off + 3] << 24)) >>> 0
    if (color !== 0) painted += 1
  }
}
check('帧缓冲画了 16×16 像素', painted === 256, `painted=${painted} ${dump(px)}`)

let keys = buildMachine(teach('ram-256'), makeDisk(assemble(KEY_SRC, RAM_BASE).bytes), rom)
if (!keys) throw new Error('键盘机没有通过自检')
keys = runSteps(keys, 4000)
keys = pressKey(keys, 65)
keys = runSteps(keys, 30)
check('按键变成扫描码并写到终端', keys.text.includes('A'), dump(keys))

let os = buildMachine(teach('ram-256'), kernelDisk(kernelSrc), rom)
if (!os) throw new Error('内核机没有通过自检')
os = runSteps(os, 250000)
const ticks = word(os, KMEM.ticks)
const sig0 = word(os, KMEM.sig0)
const sig1 = word(os, KMEM.sig1)
check('内核打印 HI', os.text.includes('HI'), dump(os))
check('定时器让两个线程都运行过', ticks >= 2 && sig0 > 0 && sig1 > 0, `ticks=${ticks} sig0=${sig0} sig1=${sig1} ${dump(os)}`)

let wide = buildMachine(
  teach('ram-1024', { gpu: 'gpu-640', monitor: 'mon-640', psu: 'psu-500' }),
  kernelDisk(kernelSrc),
  rom,
)
let narrow = buildMachine(
  teach('ram-256', { gpu: 'gpu-320', monitor: 'mon-320' }),
  kernelDisk(kernelSrc),
  rom,
)
if (!wide || !narrow) throw new Error('分辨率配置没有通过自检')
wide = runSteps(wide, 400000)
narrow = runSteps(narrow, 400000)
const countNz = (buf: Uint8Array) => {
  let n = 0
  for (let i = 0; i < buf.length; i += 4) {
    const c = (buf[i] | (buf[i + 1] << 8) | (buf[i + 2] << 16) | (buf[i + 3] << 24)) >>> 0
    if (c !== 0) n += 1
  }
  return n
}
const widePx = countNz(wide.fb)
const narrowPx = countNz(narrow.fb)
check('同一内核在更大的帧缓冲上画得更多', widePx > narrowPx && narrowPx > 0, `wide=${widePx} narrow=${narrowPx}`)

let pf = buildMachine(teach('ram-256'), makeDisk(assemble(pageSrc, RAM_BASE).bytes), rom)
if (!pf) throw new Error('缺页机没有通过自检')
pf = runSteps(pf, 20000)
check(
  '未映射地址停在出错的那一拍',
  pf.halted && pf.fault !== null && (pf.fault.va >>> 0) === 0x90000000,
  dump(pf),
)
const stuck = step(pf)
check('缺页之后再单步不会把程序计数器推走', stuck.pc === pf.pc && stuck.halted, dump(stuck))

const powerFail = evaluatePost(teach('ram-1024', { psu: 'psu-150', gpu: 'gpu-640', monitor: 'mon-640' }))
check('功率不足停在电源', powerFail.length === 1 && powerFail[0].id === 'power' && !powerFail[0].ok)

const noRam = evaluatePost({
  board: 'board-rv32',
  cpu: 'cpu-single',
  gpu: 'gpu-text',
  psu: 'psu-300',
  disk: 'disk-virt',
  monitor: 'mon-text',
})
check('没有内存停在内存步', noRam.some((s) => s.id === 'ram' && !s.ok) && noRam.every((s) => s.id === 'ram' || s.ok))

const badMon = evaluatePost(teach('ram-256', { gpu: 'gpu-320', monitor: 'mon-640' }))
check('分辨率过高停在显示', badMon.some((s) => s.id === 'video' && !s.ok) && !badMon.some((s) => s.id === 'reset'))

const pipe = buildMachine(teach('ram-256', { cpu: 'cpu-pipe' }), okDisk, rom)
if (!pipe) throw new Error('流水线 CPU 配置没有通过自检')
const pipeRan = runSteps(pipe, 5000)
check('换上流水线 CPU 后同一段程序仍能启动', pipeRan.text.includes('OK'), dump(pipeRan))

check('内核镜像大于 64KiB', KERNEL_LOAD_SIZE > 64 * 1024)

if (failed) {
  console.log(`${failed} failed`)
  process.exit(1)
}
console.log('all passed')
