const ABI = [
  'zero', 'ra', 'sp', 'gp', 'tp', 't0', 't1', 't2',
  's0', 's1', 'a0', 'a1', 'a2', 'a3', 'a4', 'a5',
  'a6', 'a7', 's2', 's3', 's4', 's5', 's6', 's7',
  's8', 's9', 's10', 's11', 't3', 't4', 't5', 't6',
] as const

export function regName(n: number): string {
  return ABI[n] ?? `x${n}`
}

export function sext(value: number, bits: number): number {
  const sign = 1 << (bits - 1)
  const mask = (1 << bits) - 1
  const v = value & mask
  return (v ^ sign) - sign
}

export type Decoded = {
  asm: string
  rd: number
  rs1: number
  rs2: number
  imm: number
  kind: 'alu' | 'load' | 'store' | 'branch' | 'jump' | 'jalr' | 'lui' | 'auipc' | 'system' | 'fence' | 'illegal'
}

function u32(word: number): number {
  return word >>> 0
}

export function decode(wordIn: number): Decoded {
  const word = u32(wordIn)
  const opcode = word & 0x7f
  const rd = (word >>> 7) & 31
  const funct3 = (word >>> 12) & 7
  const rs1 = (word >>> 15) & 31
  const rs2 = (word >>> 20) & 31
  const funct7 = (word >>> 25) & 0x7f
  const iImm = sext(word >>> 20, 12)
  const sImm = sext(((word >>> 25) << 5) | ((word >>> 7) & 0x1f), 12)
  const bImm = sext(
    ((word >>> 31) << 12) | (((word >>> 7) & 1) << 11) | (((word >>> 25) & 0x3f) << 5) | (((word >>> 8) & 0xf) << 1),
    13,
  )
  const jImm = sext(
    ((word >>> 31) << 20) | (((word >>> 12) & 0xff) << 12) | (((word >>> 20) & 1) << 11) | (((word >>> 21) & 0x3ff) << 1),
    21,
  )
  const uImm = word >>> 12

  const none = (asm: string, kind: Decoded['kind'], extra: Partial<Decoded> = {}): Decoded => ({
    asm, rd: 0, rs1: 0, rs2: 0, imm: 0, kind, ...extra,
  })

  if (opcode === 0x37) return none(`lui ${regName(rd)}, 0x${uImm.toString(16)}`, 'lui', { rd, imm: uImm })
  if (opcode === 0x17) return none(`auipc ${regName(rd)}, 0x${uImm.toString(16)}`, 'auipc', { rd, imm: uImm })
  if (opcode === 0x6f) return none(`jal ${regName(rd)}, ${jImm}`, 'jump', { rd, imm: jImm })
  if (opcode === 0x67 && funct3 === 0) {
    return none(`jalr ${regName(rd)}, ${regName(rs1)}, ${iImm}`, 'jalr', { rd, rs1, imm: iImm })
  }
  if (opcode === 0x63) {
    const name = ['beq', 'bne', '', '', 'blt', 'bge', 'bltu', 'bgeu'][funct3]
    if (!name) return none(`非法指令 ${word.toString(16)}`, 'illegal')
    return none(`${name} ${regName(rs1)}, ${regName(rs2)}, ${bImm}`, 'branch', { rs1, rs2, imm: bImm })
  }
  if (opcode === 0x03) {
    const name = ['lb', 'lh', 'lw', '', 'lbu', 'lhu'][funct3]
    if (!name) return none(`非法指令 ${word.toString(16)}`, 'illegal')
    return none(`${name} ${regName(rd)}, ${iImm}(${regName(rs1)})`, 'load', { rd, rs1, imm: iImm })
  }
  if (opcode === 0x23) {
    const name = ['sb', 'sh', 'sw'][funct3]
    if (!name) return none(`非法指令 ${word.toString(16)}`, 'illegal')
    return none(`${name} ${regName(rs2)}, ${sImm}(${regName(rs1)})`, 'store', { rs1, rs2, imm: sImm })
  }
  if (opcode === 0x13) {
    if (funct3 === 1 && funct7 === 0) {
      return none(`slli ${regName(rd)}, ${regName(rs1)}, ${rs2}`, 'alu', { rd, rs1, imm: rs2 })
    }
    if (funct3 === 5 && (funct7 === 0 || funct7 === 0x20)) {
      const name = funct7 === 0x20 ? 'srai' : 'srli'
      return none(`${name} ${regName(rd)}, ${regName(rs1)}, ${rs2}`, 'alu', { rd, rs1, imm: rs2 | (funct7 === 0x20 ? 0x100 : 0) })
    }
    const name = ['addi', '', 'slti', 'sltiu', 'xori', '', 'ori', 'andi'][funct3]
    if (!name) return none(`非法指令 ${word.toString(16)}`, 'illegal')
    return none(`${name} ${regName(rd)}, ${regName(rs1)}, ${iImm}`, 'alu', { rd, rs1, imm: iImm })
  }
  if (opcode === 0x33) {
    const table: Record<string, string> = {
      '0:0': 'add', '32:0': 'sub', '0:1': 'sll', '0:2': 'slt', '0:3': 'sltu',
      '0:4': 'xor', '0:5': 'srl', '32:5': 'sra', '0:6': 'or', '0:7': 'and',
    }
    const name = table[`${funct7}:${funct3}`]
    if (!name) return none(`非法指令 ${word.toString(16)}`, 'illegal')
    return none(`${name} ${regName(rd)}, ${regName(rs1)}, ${regName(rs2)}`, 'alu', { rd, rs1, rs2 })
  }
  if (opcode === 0x0f) return none('fence', 'fence')
  if (opcode === 0x73) {
    if (word === 0x00000073) return none('ecall', 'system')
    if (word === 0x00100073) return none('ebreak', 'system')
    if (word === 0x30200073) return none('mret', 'system')
    const csr = (word >>> 20) & 0xfff
    const csrName = csr.toString(16)
    if (funct3 === 1) return none(`csrrw ${regName(rd)}, ${csrName}, ${regName(rs1)}`, 'system', { rd, rs1, imm: csr })
    if (funct3 === 2) return none(`csrrs ${regName(rd)}, ${csrName}, ${regName(rs1)}`, 'system', { rd, rs1, imm: csr })
    if (funct3 === 3) return none(`csrrc ${regName(rd)}, ${csrName}, ${regName(rs1)}`, 'system', { rd, rs1, imm: csr })
    if (funct3 === 5) return none(`csrrwi ${regName(rd)}, ${csrName}, ${rs1}`, 'system', { rd, imm: csr, rs1 })
    if (funct3 === 6) return none(`csrrsi ${regName(rd)}, ${csrName}, ${rs1}`, 'system', { rd, imm: csr, rs1 })
    if (funct3 === 7) return none(`csrrci ${regName(rd)}, ${csrName}, ${rs1}`, 'system', { rd, imm: csr, rs1 })
    return none(`非法指令 ${word.toString(16)}`, 'illegal')
  }
  return none(`非法指令 ${word.toString(16)}`, 'illegal')
}
