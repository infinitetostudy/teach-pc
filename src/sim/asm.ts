const REGS: Record<string, number> = {
  zero: 0, x0: 0,
  ra: 1, x1: 1,
  sp: 2, x2: 2,
  gp: 3, x3: 3,
  tp: 4, x4: 4,
  t0: 5, x5: 5,
  t1: 6, x6: 6,
  t2: 7, x7: 7,
  s0: 8, fp: 8, x8: 8,
  s1: 9, x9: 9,
  a0: 10, x10: 10,
  a1: 11, x11: 11,
  a2: 12, x12: 12,
  a3: 13, x13: 13,
  a4: 14, x14: 14,
  a5: 15, x15: 15,
  a6: 16, x16: 16,
  a7: 17, x17: 17,
  s2: 18, x18: 18,
  s3: 19, x19: 19,
  s4: 20, x20: 20,
  s5: 21, x21: 21,
  s6: 22, x22: 22,
  s7: 23, x23: 23,
  s8: 24, x24: 24,
  s9: 25, x25: 25,
  s10: 26, x26: 26,
  s11: 27, x27: 27,
  t3: 28, x28: 28,
  t4: 29, x29: 29,
  t5: 30, x30: 30,
  t6: 31, x31: 31,
}

const CSRS: Record<string, number> = {
  satp: 0x180,
  mstatus: 0x300,
  mie: 0x304,
  mtvec: 0x305,
  mscratch: 0x340,
  mepc: 0x341,
  mcause: 0x342,
  mtval: 0x343,
  mip: 0x344,
}

export class AssembleError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AssembleError'
  }
}

export type AsmResult = {
  bytes: Uint8Array
  symbols: Record<string, number>
}

type Item =
  | { kind: 'label'; name: string }
  | { kind: 'equ'; name: string; expr: string }
  | { kind: 'align'; n: number }
  | { kind: 'bytes'; values: string[] }
  | { kind: 'words'; values: string[] }
  | { kind: 'asciz'; text: string }
  | { kind: 'op'; mnemonic: string; args: string[]; line: number }

function hi(x: number): number {
  const v = x >>> 0
  return ((v + 0x800) >>> 12) & 0xfffff
}

function lo(x: number): number {
  const v = x >>> 0
  const top = (hi(v) << 12) >>> 0
  return (v - top) | 0
}

function encR(funct7: number, rs2: number, rs1: number, funct3: number, rd: number, opcode: number) {
  return ((funct7 << 25) | (rs2 << 20) | (rs1 << 15) | (funct3 << 12) | (rd << 7) | opcode) >>> 0
}

function encI(imm: number, rs1: number, funct3: number, rd: number, opcode: number) {
  return ((((imm & 0xfff) << 20) | (rs1 << 15) | (funct3 << 12) | (rd << 7) | opcode) >>> 0)
}

function encS(imm: number, rs2: number, rs1: number, funct3: number, opcode: number) {
  const imm11_5 = (imm >> 5) & 0x7f
  const imm4_0 = imm & 0x1f
  return ((imm11_5 << 25) | (rs2 << 20) | (rs1 << 15) | (funct3 << 12) | (imm4_0 << 7) | opcode) >>> 0
}

function encB(imm: number, rs2: number, rs1: number, funct3: number, opcode: number) {
  const bit12 = (imm >> 12) & 1
  const bit11 = (imm >> 11) & 1
  const bit10_5 = (imm >> 5) & 0x3f
  const bit4_1 = (imm >> 1) & 0xf
  return (
    (bit12 << 31) | (bit10_5 << 25) | (rs2 << 20) | (rs1 << 15) | (funct3 << 12) | (bit4_1 << 8) | (bit11 << 7) | opcode
  ) >>> 0
}

function encU(imm20: number, rd: number, opcode: number) {
  return ((imm20 << 12) | (rd << 7) | opcode) >>> 0
}

function encJ(imm: number, rd: number, opcode: number) {
  const bit20 = (imm >> 20) & 1
  const bit10_1 = (imm >> 1) & 0x3ff
  const bit11 = (imm >> 11) & 1
  const bit19_12 = (imm >> 12) & 0xff
  return ((bit20 << 31) | (bit19_12 << 12) | (bit11 << 20) | (bit10_1 << 21) | (rd << 7) | opcode) >>> 0
}

function stripComment(line: string): string {
  let out = ''
  let quote = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (c === '"') quote = !quote
    if (!quote && (c === '#' || (c === '/' && line[i + 1] === '/'))) break
    out += c
  }
  return out.trim()
}

function splitArgs(raw: string): string[] {
  if (!raw.trim()) return []
  const args: string[] = []
  let cur = ''
  let depth = 0
  let quote = false
  for (const c of raw) {
    if (c === '"') quote = !quote
    if (!quote && c === '(') depth++
    if (!quote && c === ')') depth--
    if (!quote && c === ',' && depth === 0) {
      args.push(cur.trim())
      cur = ''
    } else cur += c
  }
  if (cur.trim()) args.push(cur.trim())
  return args
}

function parseProgram(source: string): Item[] {
  const items: Item[] = []
  const lines = source.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const lineNo = i + 1
    let text = stripComment(lines[i])
    if (!text) continue
    while (true) {
      const m = text.match(/^([A-Za-z_.][\w.]*):\s*(.*)$/)
      if (!m) break
      items.push({ kind: 'label', name: m[1] })
      text = m[2].trim()
      if (!text) break
    }
    if (!text) continue
    const dir = text.match(/^(\.[A-Za-z]+)\s*(.*)$/)
    if (dir) {
      const name = dir[1]
      const rest = dir[2]
      if (name === '.equ') {
        const mm = rest.match(/^([A-Za-z_.][\w.]*)\s*,\s*(.+)$/)
        if (!mm) throw new AssembleError(`第 ${lineNo} 行 .equ 写错了`)
        items.push({ kind: 'equ', name: mm[1], expr: mm[2].trim() })
      } else if (name === '.balign' || name === '.align') {
        const n = Number(rest)
        if (!Number.isFinite(n) || n <= 0) throw new AssembleError(`第 ${lineNo} 行对齐非法`)
        items.push({ kind: 'align', n: name === '.align' ? 2 ** n : n })
      } else if (name === '.word') {
        items.push({ kind: 'words', values: splitArgs(rest) })
      } else if (name === '.byte') {
        items.push({ kind: 'bytes', values: splitArgs(rest) })
      } else if (name === '.asciz' || name === '.ascii') {
        const sm = rest.match(/^"(.*)"$/)
        if (!sm) throw new AssembleError(`第 ${lineNo} 行字符串要写在双引号里`)
        const decoded = sm[1].replace(/\\n/g, '\n').replace(/\\0/g, '\0').replace(/\\t/g, '\t')
        items.push({ kind: 'asciz', text: decoded + (name === '.asciz' ? '\0' : '') })
      } else if (name === '.section' || name === '.text' || name === '.data' || name === '.globl') {
        continue
      } else {
        throw new AssembleError(`第 ${lineNo} 行不认识 ${name}`)
      }
      continue
    }
    const op = text.match(/^([a-z][a-z0-9.]*)\s*(.*)$/i)
    if (!op) throw new AssembleError(`第 ${lineNo} 行无法解析：${text}`)
    items.push({ kind: 'op', mnemonic: op[1].toLowerCase(), args: splitArgs(op[2]), line: lineNo })
  }
  return items
}

function evalExpr(expr: string, symbols: Record<string, number>, pc: number): number {
  const e = expr.trim()
  const hiM = e.match(/^%hi\((.+)\)$/)
  if (hiM) return hi(evalExpr(hiM[1], symbols, pc))
  const loM = e.match(/^%lo\((.+)\)$/)
  if (loM) return lo(evalExpr(loM[1], symbols, pc))
  if (e === '.') return pc
  if (/^'.*'$/.test(e)) {
    const body = e.slice(1, -1).replace(/\\n/g, '\n')
    if (body.length !== 1) throw new AssembleError(`字符立即数无效：${e}`)
    return body.charCodeAt(0)
  }
  if (/^[+-]?0x[0-9a-f]+$/i.test(e)) return Number(e) | 0
  if (/^[+-]?\d+$/.test(e)) return Number(e) | 0
  if (e in symbols) return symbols[e]
  throw new AssembleError(`不知道这个数：${e}`)
}

function reg(name: string, line: number): number {
  const n = REGS[name]
  if (n === undefined) throw new AssembleError(`第 ${line} 行没有寄存器 ${name}`)
  return n
}

function csrNum(name: string, symbols: Record<string, number>, pc: number, line: number): number {
  if (name in CSRS) return CSRS[name]
  try {
    return evalExpr(name, symbols, pc) >>> 0
  } catch {
    throw new AssembleError(`第 ${line} 行没有 CSR ${name}`)
  }
}

function memOperand(arg: string, symbols: Record<string, number>, pc: number, line: number): { imm: number; rs1: number } {
  const m = arg.match(/^(.+)\(([A-Za-z0-9]+)\)$/)
  if (!m) throw new AssembleError(`第 ${line} 行访存格式应为偏移(寄存器)`)
  return { imm: evalExpr(m[1], symbols, pc), rs1: reg(m[2], line) }
}

function sizeOf(item: Item, pc: number): number {
  if (item.kind === 'label' || item.kind === 'equ') return 0
  if (item.kind === 'align') return (item.n - (pc % item.n)) % item.n
  if (item.kind === 'bytes') return item.values.length
  if (item.kind === 'words') return item.values.length * 4
  if (item.kind === 'asciz') return new TextEncoder().encode(item.text).length
  if (item.kind === 'op') return item.mnemonic === 'li' ? 8 : 4
  return 0
}

export function assemble(source: string, base = 0): AsmResult {
  const items = parseProgram(source)
  const symbols: Record<string, number> = {}
  for (const item of items) {
    if (item.kind === 'equ') symbols[item.name] = evalExpr(item.expr, symbols, base)
  }
  let pc = base
  for (const item of items) {
    if (item.kind === 'label') {
      if (item.name in symbols && symbols[item.name] !== pc) {
        throw new AssembleError(`标号重复：${item.name}`)
      }
      symbols[item.name] = pc
      continue
    }
    if (item.kind === 'equ') continue
    pc += sizeOf(item, pc)
  }

  const raw: number[] = []
  pc = base
  const emitByte = (b: number) => {
    raw.push(b & 0xff)
    pc += 1
  }
  const emitWord = (w: number) => {
    const v = w >>> 0
    raw.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >> 24) & 0xff)
    pc += 4
  }

  for (const item of items) {
    if (item.kind === 'label' || item.kind === 'equ') continue
    if (item.kind === 'align') {
      const pad = (item.n - (pc % item.n)) % item.n
      for (let i = 0; i < pad; i++) emitByte(0)
      continue
    }
    if (item.kind === 'bytes') {
      for (const v of item.values) emitByte(evalExpr(v, symbols, pc))
      continue
    }
    if (item.kind === 'words') {
      for (const v of item.values) emitWord(evalExpr(v, symbols, pc))
      continue
    }
    if (item.kind === 'asciz') {
      for (const b of new TextEncoder().encode(item.text)) emitByte(b)
      continue
    }
    emitOp(item, symbols, pc, emitWord)
  }
  return { bytes: new Uint8Array(raw), symbols }
}

function emitOp(
  item: Extract<Item, { kind: 'op' }>,
  symbols: Record<string, number>,
  pc: number,
  emitWord: (w: number) => void,
) {
  const { mnemonic, args, line } = item
  const need = (n: number) => {
    if (args.length !== n) throw new AssembleError(`第 ${line} 行 ${mnemonic} 需要 ${n} 个操作数`)
  }
  const rd = () => reg(args[0], line)
  const branchImm = (label: string) => {
    const target = evalExpr(label, symbols, pc)
    const imm = (target - pc) | 0
    if (imm % 2 !== 0 || imm < -4096 || imm > 4094) {
      throw new AssembleError(`第 ${line} 行分支超出范围`)
    }
    return imm
  }
  const jumpImm = (label: string) => {
    const target = evalExpr(label, symbols, pc)
    const imm = (target - pc) | 0
    if (imm % 2 !== 0 || imm < -1048576 || imm > 1048574) {
      throw new AssembleError(`第 ${line} 行跳转超出范围`)
    }
    return imm
  }

  const opImm: Record<string, number> = {
    addi: 0, slti: 2, sltiu: 3, xori: 4, ori: 6, andi: 7,
  }
  const opReg: Record<string, [number, number]> = {
    add: [0x00, 0], sub: [0x20, 0], sll: [0x00, 1], slt: [0x00, 2], sltu: [0x00, 3],
    xor: [0x00, 4], srl: [0x00, 5], sra: [0x20, 5], or: [0x00, 6], and: [0x00, 7],
  }
  const loads: Record<string, number> = { lb: 0, lh: 1, lw: 2, lbu: 4, lhu: 5 }
  const stores: Record<string, number> = { sb: 0, sh: 1, sw: 2 }
  const branches: Record<string, number> = { beq: 0, bne: 1, blt: 4, bge: 5, bltu: 6, bgeu: 7 }

  if (mnemonic === 'nop') {
    emitWord(encI(0, 0, 0, 0, 0x13))
    return
  }
  if (mnemonic === 'li') {
    need(2)
    const imm = evalExpr(args[1], symbols, pc) | 0
    const d = rd()
    emitWord(encU(hi(imm), d, 0x37))
    emitWord(encI(lo(imm), d, 0, d, 0x13))
    return
  }
  if (mnemonic === 'mv') {
    need(2)
    emitWord(encI(0, reg(args[1], line), 0, rd(), 0x13))
    return
  }
  if (mnemonic === 'j') {
    need(1)
    emitWord(encJ(jumpImm(args[0]), 0, 0x6f))
    return
  }
  if (mnemonic === 'jr') {
    need(1)
    emitWord(encI(0, reg(args[0], line), 0, 0, 0x67))
    return
  }
  if (mnemonic === 'ret') {
    emitWord(encI(0, 1, 0, 0, 0x67))
    return
  }
  if (mnemonic === 'call') {
    need(1)
    emitWord(encJ(jumpImm(args[0]), 1, 0x6f))
    return
  }
  if (mnemonic === 'lui' || mnemonic === 'auipc') {
    need(2)
    const imm = evalExpr(args[1], symbols, pc)
    const imm20 = mnemonic === 'lui' || mnemonic === 'auipc' ? (imm & 0xfffff) : imm
    emitWord(encU(imm20, rd(), mnemonic === 'lui' ? 0x37 : 0x17))
    return
  }
  if (mnemonic === 'jal') {
    need(2)
    emitWord(encJ(jumpImm(args[1]), rd(), 0x6f))
    return
  }
  if (mnemonic === 'jalr') {
    need(3)
    emitWord(encI(evalExpr(args[2], symbols, pc), reg(args[1], line), 0, rd(), 0x67))
    return
  }
  if (mnemonic in branches) {
    need(3)
    emitWord(encB(branchImm(args[2]), reg(args[1], line), reg(args[0], line), branches[mnemonic], 0x63))
    return
  }
  if (mnemonic in loads) {
    need(2)
    const mem = memOperand(args[1], symbols, pc, line)
    emitWord(encI(mem.imm, mem.rs1, loads[mnemonic], rd(), 0x03))
    return
  }
  if (mnemonic in stores) {
    need(2)
    const mem = memOperand(args[1], symbols, pc, line)
    emitWord(encS(mem.imm, reg(args[0], line), mem.rs1, stores[mnemonic], 0x23))
    return
  }
  if (mnemonic in opImm) {
    need(3)
    emitWord(encI(evalExpr(args[2], symbols, pc), reg(args[1], line), opImm[mnemonic], rd(), 0x13))
    return
  }
  if (mnemonic === 'slli' || mnemonic === 'srli' || mnemonic === 'srai') {
    need(3)
    const shamt = evalExpr(args[2], symbols, pc) & 31
    const funct7 = mnemonic === 'srai' ? 0x20 : 0x00
    const funct3 = mnemonic === 'slli' ? 1 : 5
    emitWord(encR(funct7, shamt, reg(args[1], line), funct3, rd(), 0x13))
    return
  }
  if (mnemonic in opReg) {
    need(3)
    const [funct7, funct3] = opReg[mnemonic]
    emitWord(encR(funct7, reg(args[2], line), reg(args[1], line), funct3, rd(), 0x33))
    return
  }
  if (mnemonic === 'fence') {
    emitWord(0x0000000f)
    return
  }
  if (mnemonic === 'ecall') {
    emitWord(0x00000073)
    return
  }
  if (mnemonic === 'ebreak') {
    emitWord(0x00100073)
    return
  }
  if (mnemonic === 'mret') {
    emitWord(0x30200073)
    return
  }
  if (mnemonic === 'csrr') {
    need(2)
    const csr = csrNum(args[1], symbols, pc, line)
    emitWord(encI(csr, 0, 2, rd(), 0x73))
    return
  }
  if (mnemonic === 'csrw') {
    need(2)
    const csr = csrNum(args[0], symbols, pc, line)
    emitWord(encI(csr, reg(args[1], line), 1, 0, 0x73))
    return
  }
  if (mnemonic === 'csrrw' || mnemonic === 'csrrs' || mnemonic === 'csrrc') {
    need(3)
    const funct3 = mnemonic === 'csrrw' ? 1 : mnemonic === 'csrrs' ? 2 : 3
    const csr = csrNum(args[1], symbols, pc, line)
    emitWord(encI(csr, reg(args[2], line), funct3, rd(), 0x73))
    return
  }
  if (mnemonic === 'csrrwi' || mnemonic === 'csrrsi' || mnemonic === 'csrrci') {
    need(3)
    const funct3 = mnemonic === 'csrrwi' ? 5 : mnemonic === 'csrrsi' ? 6 : 7
    const csr = csrNum(args[1], symbols, pc, line)
    const zimm = evalExpr(args[2], symbols, pc) & 31
    emitWord(encI(csr, zimm, funct3, rd(), 0x73))
    return
  }
  throw new AssembleError(`第 ${line} 行不支持指令 ${mnemonic}`)
}

export function pad4(bytes: Uint8Array): Uint8Array {
  const n = (bytes.length + 3) & ~3
  if (n === bytes.length) return bytes
  const out = new Uint8Array(n)
  out.set(bytes)
  return out
}
