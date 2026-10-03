import { FB_BASE, INFO_BASE, KBD_BASE, RAM_BASE, TIMER_BASE, UART_BASE } from '../spec'
import { decode, regName, sext } from './decode'
import { type Access, type Fault, type Machine, type Trace, regionName } from './machine'

function u8at(buf: Uint8Array, off: number): number {
  return buf[off] ?? 0
}

function readU32(buf: Uint8Array, off: number): number {
  return (u8at(buf, off) | (u8at(buf, off + 1) << 8) | (u8at(buf, off + 2) << 16) | (u8at(buf, off + 3) << 24)) >>> 0
}

function writeU32(buf: Uint8Array, off: number, value: number) {
  buf[off] = value & 0xff
  buf[off + 1] = (value >>> 8) & 0xff
  buf[off + 2] = (value >>> 16) & 0xff
  buf[off + 3] = (value >>> 24) & 0xff
}

function spawn(m: Machine): Machine {
  return {
    ...m,
    regs: m.regs.slice(),
    history: m.history.slice(),
    ramOwned: false,
    fbOwned: false,
    fault: m.fault ? { ...m.fault } : null,
    lastAccess: m.lastAccess ? { ...m.lastAccess } : null,
    trace: m.trace ? { ...m.trace } : null,
  }
}

function ramBuf(m: Machine): Uint8Array {
  if (!m.ramOwned) {
    m.ram = m.ram.slice()
    m.ramOwned = true
  }
  return m.ram
}

function fbBuf(m: Machine): Uint8Array {
  if (!m.fbOwned) {
    m.fb = m.fb.slice()
    m.fbOwned = true
  }
  return m.fb
}

function setReg(m: Machine, rd: number, value: number) {
  if (rd !== 0) m.regs[rd] = value | 0
}

function note(m: Machine, addr: number, write: boolean, size: number) {
  const access: Access = { addr: addr >>> 0, write, size, region: regionName(m, addr) }
  m.lastAccess = access
}

function stop(m: Machine, reason: string) {
  m.halted = true
  m.haltReason = reason
}

function remember(m: Machine, line: string) {
  m.history.push(line)
  if (m.history.length > 32) m.history.shift()
}

function emptyTrace(pc: number, instr: number, asm: string): Trace {
  return {
    pc,
    instr,
    asm,
    rs1: 0,
    rs2: 0,
    rd: 0,
    rs1v: 0,
    rs2v: 0,
    alu: 0,
    memAddr: null,
    memVal: null,
    memWrite: false,
    wb: null,
    nextPc: pc,
    trap: null,
  }
}

type Walk = { pa: number } | { fault: Fault }

function readPte(m: Machine, addr: number): number {
  const a = addr >>> 0
  const off = a - RAM_BASE
  if (off < 0 || off + 4 > m.ram.length) return 0
  return readU32(m.ram, off)
}

function translate(m: Machine, va: number, access: 'x' | 'r' | 'w', accessName: string): Walk {
  const addr = va >>> 0
  if ((m.satp >>> 31) === 0) return { pa: addr }
  const vpn1 = (addr >>> 22) & 0x3ff
  const vpn0 = (addr >>> 12) & 0x3ff
  const off = addr & 0xfff
  const root = (m.satp & 0x3fffff) << 12
  const pte1Addr = (root + vpn1 * 4) >>> 0
  const pte1 = readPte(m, pte1Addr)
  if ((pte1 & 1) === 0) {
    return { fault: { va: addr, pteAddr: pte1Addr, pte: pte1, level: 1, access: accessName } }
  }
  const leaf1 = (pte1 & 0xe) !== 0
  if (leaf1) {
    if (!permOk(pte1, access)) {
      return { fault: { va: addr, pteAddr: pte1Addr, pte: pte1, level: 1, access: accessName } }
    }
    const ppn = pte1 >>> 10
    const pa = (((ppn & ~0x3ff) << 12) | (vpn0 << 12) | off) >>> 0
    return { pa }
  }
  const table = (pte1 >>> 10) << 12
  const pte0Addr = (table + vpn0 * 4) >>> 0
  const pte0 = readPte(m, pte0Addr)
  if ((pte0 & 1) === 0 || (pte0 & 0xe) === 0 || !permOk(pte0, access)) {
    return { fault: { va: addr, pteAddr: pte0Addr, pte: pte0, level: 2, access: accessName } }
  }
  const pa = (((pte0 >>> 10) << 12) | off) >>> 0
  return { pa }
}

function permOk(pte: number, access: 'x' | 'r' | 'w'): boolean {
  const r = (pte & 2) !== 0
  const w = (pte & 4) !== 0
  const x = (pte & 8) !== 0
  if (access === 'x') return x
  if (access === 'r') return r
  return w
}

function freezeFault(m: Machine, fault: Fault) {
  m.fault = fault
  m.halted = true
  m.haltReason = `${fault.access}时虚地址翻译失败`
  const trace = m.trace ?? emptyTrace(m.pc, 0, fault.access)
  trace.trap = m.haltReason
  trace.memAddr = fault.va
  m.trace = trace
  note(m, fault.pteAddr, false, 4)
}

function timerPending(m: Machine): boolean {
  return m.mtimecmp !== 0 && m.mtime >= m.mtimecmp
}

function readCsr(m: Machine, csr: number): number {
  if (csr === 0x300) return m.mstatus >>> 0
  if (csr === 0x304) return m.mie >>> 0
  if (csr === 0x305) return m.mtvec >>> 0
  if (csr === 0x340) return m.mscratch >>> 0
  if (csr === 0x341) return m.mepc >>> 0
  if (csr === 0x342) return m.mcause >>> 0
  if (csr === 0x343) return m.mtval >>> 0
  if (csr === 0x180) return m.satp >>> 0
  if (csr === 0x344) {
    let mip = 0
    if (timerPending(m)) mip |= 0x80
    if (m.kbdIrq) mip |= 0x800
    return mip >>> 0
  }
  return 0
}

function writeCsr(m: Machine, csr: number, value: number) {
  const v = value >>> 0
  if (csr === 0x300) m.mstatus = v
  else if (csr === 0x304) m.mie = v
  else if (csr === 0x305) m.mtvec = v
  else if (csr === 0x340) m.mscratch = v
  else if (csr === 0x341) m.mepc = v
  else if (csr === 0x342) m.mcause = v
  else if (csr === 0x343) m.mtval = v
  else if (csr === 0x180) m.satp = v
}

function takeTrap(m: Machine, cause: number, pc: number, name: string) {
  const mie = (m.mstatus >>> 3) & 1
  let ms = m.mstatus >>> 0
  ms = (ms & ~(1 << 7)) | (mie << 7)
  ms = ms & ~(1 << 3)
  ms = ms & ~(3 << 11)
  if (m.priv === 'M') ms |= 3 << 11
  m.mstatus = ms >>> 0
  m.mepc = pc >>> 0
  m.mcause = cause >>> 0
  m.mtval = 0
  m.priv = 'M'
  const next = (m.mtvec & ~3) >>> 0
  const trace = emptyTrace(pc, 0, name)
  trace.trap = name
  trace.nextPc = next
  trace.alu = cause >>> 0
  m.trace = trace
  m.pc = next
  remember(m, name)
}

function finishBeat(m: Machine) {
  m.mtime += 1
  m.scanY = (m.scanY + 1) % m.scanHeight
  m.cycle += 1
  if (m.pc >= RAM_BASE) m.bootDone = true
}

function readPhys(m: Machine, pa: number, size: number): { ok: true; value: number } | { ok: false; reason: string } {
  const addr = pa >>> 0
  note(m, addr, false, size)
  if (addr < 0x1000) {
    if (addr + size > m.rom.length) return { ok: false, reason: '引导 ROM 越界' }
    if (size === 1) return { ok: true, value: m.rom[addr] }
    if (size === 2) return { ok: true, value: m.rom[addr] | (m.rom[addr + 1] << 8) }
    return { ok: true, value: readU32(m.rom, addr) }
  }
  if (addr >= TIMER_BASE && addr < TIMER_BASE + 0x20) {
    const off = addr - TIMER_BASE
    if (size !== 4) return { ok: false, reason: '定时器只接受 4 字节访问' }
    if (off === 0) return { ok: true, value: m.mtime >>> 0 }
    if (off === 4) return { ok: true, value: Math.floor(m.mtime / 2 ** 32) >>> 0 }
    if (off === 8) return { ok: true, value: m.mtimecmp >>> 0 }
    if (off === 12) return { ok: true, value: Math.floor(m.mtimecmp / 2 ** 32) >>> 0 }
    return { ok: true, value: 0 }
  }
  if (addr >= UART_BASE && addr < UART_BASE + 0x20) return { ok: true, value: 0 }
  if (addr >= KBD_BASE && addr < KBD_BASE + 0x20) {
    const off = addr - KBD_BASE
    if (off === 0) {
      const value = m.kbdReady ? m.kbdCode & 0xff : 0
      m.kbdReady = false
      m.kbdIrq = false
      return { ok: true, value }
    }
    if (off === 4) return { ok: true, value: m.kbdReady ? 1 : 0 }
    if (off === 8) return { ok: true, value: m.kbdIrq ? 1 : 0 }
    return { ok: true, value: 0 }
  }
  if (addr >= INFO_BASE && addr < INFO_BASE + 0x20) {
    const off = addr - INFO_BASE
    if (off === 0) return { ok: true, value: m.ramBytes >>> 0 }
    if (off === 4) return { ok: true, value: m.fbWidth >>> 0 }
    if (off === 8) return { ok: true, value: m.fbHeight >>> 0 }
    if (off === 12) return { ok: true, value: m.gpuMode === 'fb' ? 1 : 0 }
    if (off === 16) return { ok: true, value: FB_BASE }
    return { ok: true, value: 0 }
  }
  if (m.fb.length > 0 && addr >= FB_BASE && addr < FB_BASE + m.fb.length) {
    const off = addr - FB_BASE
    if (off + size > m.fb.length) return { ok: false, reason: '显存越界' }
    if (size === 1) return { ok: true, value: m.fb[off] }
    if (size === 2) return { ok: true, value: m.fb[off] | (m.fb[off + 1] << 8) }
    return { ok: true, value: readU32(m.fb, off) }
  }
  if (m.disk.length > 0 && addr >= 0x40000000 && addr < 0x40000000 + m.disk.length) {
    const off = addr - 0x40000000
    if (off + size > m.disk.length) return { ok: false, reason: '磁盘窗口越界' }
    if (size === 1) return { ok: true, value: m.disk[off] }
    if (size === 2) return { ok: true, value: m.disk[off] | (m.disk[off + 1] << 8) }
    return { ok: true, value: readU32(m.disk, off) }
  }
  if (addr >= RAM_BASE && addr < RAM_BASE + m.ram.length) {
    const off = addr - RAM_BASE
    if (off + size > m.ram.length) return { ok: false, reason: '内存越界' }
    if (size === 1) return { ok: true, value: m.ram[off] }
    if (size === 2) return { ok: true, value: m.ram[off] | (m.ram[off + 1] << 8) }
    return { ok: true, value: readU32(m.ram, off) }
  }
  return { ok: false, reason: `地址 ${addr.toString(16)} 没有落到任何零件` }
}

function writePhys(m: Machine, pa: number, size: number, value: number): { ok: true } | { ok: false; reason: string } {
  const addr = pa >>> 0
  note(m, addr, true, size)
  if (addr < 0x1000) return { ok: false, reason: '引导 ROM 只读' }
  if (addr >= TIMER_BASE && addr < TIMER_BASE + 0x20) {
    const off = addr - TIMER_BASE
    if (size !== 4) return { ok: false, reason: '定时器只接受 4 字节访问' }
    if (off === 0) m.mtime = (Math.floor(m.mtime / 2 ** 32) * 2 ** 32 + (value >>> 0))
    else if (off === 4) m.mtime = (value >>> 0) * 2 ** 32 + (m.mtime >>> 0)
    else if (off === 8) m.mtimecmp = (Math.floor(m.mtimecmp / 2 ** 32) * 2 ** 32 + (value >>> 0))
    else if (off === 12) m.mtimecmp = (value >>> 0) * 2 ** 32 + (m.mtimecmp >>> 0)
    return { ok: true }
  }
  if (addr >= UART_BASE && addr < UART_BASE + 0x20) {
    const ch = value & 0xff
    if (ch !== 0) m.text += String.fromCharCode(ch)
    if (m.text.length > 4000) m.text = m.text.slice(-4000)
    return { ok: true }
  }
  if (addr >= KBD_BASE && addr < KBD_BASE + 0x20) return { ok: true }
  if (addr >= INFO_BASE && addr < INFO_BASE + 0x20) return { ok: true }
  if (m.fb.length > 0 && addr >= FB_BASE && addr < FB_BASE + m.fb.length) {
    const buf = fbBuf(m)
    const off = addr - FB_BASE
    if (size === 1) buf[off] = value & 0xff
    else if (size === 2) {
      buf[off] = value & 0xff
      buf[off + 1] = (value >>> 8) & 0xff
    } else writeU32(buf, off, value)
    return { ok: true }
  }
  if (m.disk.length > 0 && addr >= 0x40000000 && addr < 0x40000000 + m.disk.length) {
    return { ok: false, reason: '磁盘窗口只读' }
  }
  if (addr >= RAM_BASE && addr < RAM_BASE + m.ram.length) {
    const buf = ramBuf(m)
    const off = addr - RAM_BASE
    if (size === 1) buf[off] = value & 0xff
    else if (size === 2) {
      buf[off] = value & 0xff
      buf[off + 1] = (value >>> 8) & 0xff
    } else writeU32(buf, off, value)
    return { ok: true }
  }
  return { ok: false, reason: `地址 ${addr.toString(16)} 没有落到任何零件` }
}

function alu(op: string, a: number, b: number): number {
  const A = a | 0
  const B = b | 0
  switch (op) {
    case 'add':
    case 'addi':
      return (A + B) | 0
    case 'sub':
      return (A - B) | 0
    case 'and':
    case 'andi':
      return A & B
    case 'or':
    case 'ori':
      return A | B
    case 'xor':
    case 'xori':
      return A ^ B
    case 'sll':
    case 'slli':
      return (A << (B & 31)) | 0
    case 'srl':
    case 'srli':
      return (A >>> (B & 31)) | 0
    case 'sra':
    case 'srai':
      return A >> (B & 31)
    case 'slt':
    case 'slti':
      return A < B ? 1 : 0
    case 'sltu':
    case 'sltiu':
      return (A >>> 0) < (B >>> 0) ? 1 : 0
    default:
      return 0
  }
}

function branchTaken(op: string, a: number, b: number): boolean {
  const A = a | 0
  const B = b | 0
  switch (op) {
    case 'beq':
      return A === B
    case 'bne':
      return A !== B
    case 'blt':
      return A < B
    case 'bge':
      return A >= B
    case 'bltu':
      return (A >>> 0) < (B >>> 0)
    case 'bgeu':
      return (A >>> 0) >= (B >>> 0)
    default:
      return false
  }
}

function loadValue(raw: number, op: string): number {
  if (op === 'lb') return sext(raw, 8)
  if (op === 'lbu') return raw & 0xff
  if (op === 'lh') return sext(raw, 16)
  if (op === 'lhu') return raw & 0xffff
  return raw | 0
}

function exec(m: Machine) {
  if (m.halted) return
  if ((m.pc & 3) !== 0) {
    stop(m, '程序计数器没有 4 字节对齐')
    finishBeat(m)
    return
  }

  const mieGlobal = ((m.mstatus >>> 3) & 1) === 1
  if (mieGlobal) {
    if (((m.mie >>> 7) & 1) === 1 && timerPending(m)) {
      takeTrap(m, 0x80000007, m.pc, '定时器中断')
      finishBeat(m)
      return
    }
    if (((m.mie >>> 11) & 1) === 1 && m.kbdIrq) {
      takeTrap(m, 0x8000000b, m.pc, '键盘中断')
      finishBeat(m)
      return
    }
  }

  const fetchWalk = translate(m, m.pc, 'x', '取指')
  if ('fault' in fetchWalk) {
    freezeFault(m, fetchWalk.fault)
    finishBeat(m)
    return
  }
  const fetched = readPhys(m, fetchWalk.pa, 4)
  if (!fetched.ok) {
    stop(m, fetched.reason)
    finishBeat(m)
    return
  }
  const instr = fetched.value >>> 0
  const d = decode(instr)
  const op = d.asm.split(' ')[0]
  const trace = emptyTrace(m.pc, instr, d.asm)
  trace.rs1 = d.rs1
  trace.rs2 = d.rs2
  trace.rd = d.rd
  trace.rs1v = m.regs[d.rs1] | 0
  trace.rs2v = m.regs[d.rs2] | 0
  m.trace = trace

  if (d.kind === 'illegal') {
    stop(m, `不认识的指令 ${instr.toString(16)}`)
    remember(m, d.asm)
    finishBeat(m)
    return
  }

  const rs1v = m.regs[d.rs1] | 0
  const rs2v = m.regs[d.rs2] | 0
  let nextPc = (m.pc + 4) >>> 0

  if (d.kind === 'alu') {
    const b = op === 'add' || op === 'sub' || op === 'and' || op === 'or' || op === 'xor' || op === 'sll' || op === 'slt' || op === 'sltu' || op === 'srl' || op === 'sra'
      ? rs2v
      : d.imm
    const result = alu(op, rs1v, b)
    trace.alu = result
    trace.wb = result
    setReg(m, d.rd, result)
  } else if (d.kind === 'lui') {
    const result = (d.imm << 12) | 0
    trace.alu = result
    trace.wb = result
    setReg(m, d.rd, result)
  } else if (d.kind === 'auipc') {
    const result = (m.pc + ((d.imm << 12) | 0)) | 0
    trace.alu = result
    trace.wb = result
    setReg(m, d.rd, result)
  } else if (d.kind === 'jump') {
    const target = (m.pc + d.imm) >>> 0
    trace.alu = target
    trace.wb = nextPc | 0
    setReg(m, d.rd, nextPc)
    nextPc = target
  } else if (d.kind === 'jalr') {
    const target = (rs1v + d.imm) & ~1
    trace.alu = target >>> 0
    trace.wb = nextPc | 0
    setReg(m, d.rd, nextPc)
    nextPc = target >>> 0
  } else if (d.kind === 'branch') {
    const yes = branchTaken(op, rs1v, rs2v)
    const target = (m.pc + d.imm) >>> 0
    trace.alu = yes ? 1 : 0
    if (yes) nextPc = target
  } else if (d.kind === 'load' || d.kind === 'store') {
    const size = op === 'lb' || op === 'lbu' || op === 'sb' ? 1 : op === 'lh' || op === 'lhu' || op === 'sh' ? 2 : 4
    const addr = (rs1v + d.imm) >>> 0
    trace.memAddr = addr
    trace.alu = addr | 0
    trace.memWrite = d.kind === 'store'
    if ((size === 4 && (addr & 3) !== 0) || (size === 2 && (addr & 1) !== 0)) {
      stop(m, '访存地址没有对齐')
      remember(m, d.asm)
      finishBeat(m)
      return
    }
    const access = d.kind === 'store' ? 'w' : 'r'
    const walk = translate(m, addr, access, d.kind === 'store' ? '写内存' : '读内存')
    if ('fault' in walk) {
      freezeFault(m, walk.fault)
      remember(m, d.asm)
      finishBeat(m)
      return
    }
    if (d.kind === 'load') {
      const got = readPhys(m, walk.pa, size)
      if (!got.ok) {
        stop(m, got.reason)
        remember(m, d.asm)
        finishBeat(m)
        return
      }
      const value = loadValue(got.value, op)
      trace.memVal = value
      trace.wb = value
      setReg(m, d.rd, value)
    } else {
      const storeVal = size === 1 ? rs2v & 0xff : size === 2 ? rs2v & 0xffff : rs2v >>> 0
      trace.memVal = rs2v | 0
      const put = writePhys(m, walk.pa, size, storeVal)
      if (!put.ok) {
        stop(m, put.reason)
        remember(m, d.asm)
        finishBeat(m)
        return
      }
    }
  } else if (d.kind === 'fence') {
    trace.alu = 0
  } else if (d.kind === 'system') {
    if (op === 'ebreak') {
      const code = m.regs[10] | 0
      stop(m, code === 1 ? '内存容量小于要装入的程序' : code === 2 ? '磁盘魔数不对' : 'ebreak 停机')
      remember(m, d.asm)
      finishBeat(m)
      return
    }
    if (op === 'ecall') {
      if (m.priv !== 'M' && m.priv !== 'U') stop(m, 'ecall')
      takeTrap(m, m.priv === 'M' ? 11 : 8, m.pc, 'ecall')
      finishBeat(m)
      return
    }
    if (op === 'mret') {
      if (m.priv !== 'M') {
        stop(m, '用户态不能执行 mret')
        finishBeat(m)
        return
      }
      const mpp = (m.mstatus >>> 11) & 3
      const mpie = (m.mstatus >>> 7) & 1
      let ms = m.mstatus >>> 0
      ms = (ms & ~(1 << 3)) | (mpie << 3)
      ms = ms | (1 << 7)
      ms = ms & ~(3 << 11)
      m.mstatus = ms >>> 0
      m.priv = mpp === 3 ? 'M' : 'U'
      nextPc = m.mepc >>> 0
      trace.alu = nextPc | 0
      trace.trap = 'mret'
    } else if (op.startsWith('csr')) {
      if (m.priv !== 'M') {
        stop(m, '用户态不能读写控制状态寄存器')
        remember(m, d.asm)
        finishBeat(m)
        return
      }
      const csr = d.imm >>> 0
      const isImm = op === 'csrrwi' || op === 'csrrsi' || op === 'csrrci'
      const src = isImm ? d.rs1 : rs1v
      const old = readCsr(m, csr)
      const funct = op === 'csrrw' || op === 'csrrwi' ? 'w' : op === 'csrrs' || op === 'csrrsi' ? 's' : 'c'
      let next = old
      if (funct === 'w') next = src >>> 0
      if (funct === 's') next = (old | src) >>> 0
      if (funct === 'c') next = (old & ~src) >>> 0
      const write = funct === 'w' || src !== 0
      if (write) writeCsr(m, csr, next)
      trace.alu = next | 0
      trace.wb = old | 0
      setReg(m, d.rd, old)
    }
  }

  trace.nextPc = nextPc
  m.pc = nextPc
  remember(m, d.asm)
  finishBeat(m)
}

export function step(m: Machine): Machine {
  if (m.halted) return m
  const n = spawn(m)
  exec(n)
  return n
}

export function runSteps(m: Machine, count: number): Machine {
  if (m.halted || count <= 0) return m
  const n = spawn(m)
  for (let i = 0; i < count && !n.halted; i++) exec(n)
  return n
}

export function pressKey(m: Machine, code: number): Machine {
  const n = spawn(m)
  n.kbdCode = code & 0xff
  n.kbdReady = true
  n.kbdIrq = true
  n.lastKey = code & 0xff
  return n
}

export { regName }
