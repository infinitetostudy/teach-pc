import type { Part } from './catalog'
import { decode, regName, type Decoded } from './sim/decode'
import type { Machine, Trace } from './sim/machine'
import { DISK_BASE, FB_BASE, RAM_BASE, hex } from './spec'

const WIDTH = 16

type Lamp = { name: string; on: boolean; hint: string }

function bitsOf(n: number, width: number): number[] {
  const out: number[] = []
  for (let i = width - 1; i >= 0; i--) out.push((n >>> i) & 1)
  return out
}

function ripple(a: number, b: number, cin: number, width: number) {
  const A: number[] = []
  const B: number[] = []
  const C: number[] = []
  const S: number[] = []
  let carry = cin & 1
  for (let i = 0; i < width; i++) {
    const ba = (a >>> i) & 1
    const bb = (b >>> i) & 1
    const sum = ba ^ bb ^ carry
    const next = (ba & bb) | (ba & carry) | (bb & carry)
    A.push(ba)
    B.push(bb)
    C.push(carry)
    S.push(sum)
    carry = next
  }
  return { A: A.reverse(), B: B.reverse(), C: C.reverse(), S: S.reverse() }
}

function opName(decoded: Decoded | null): string {
  return decoded?.asm.split(' ')[0] ?? ''
}

function controlLamps(decoded: Decoded | null): Lamp[] {
  const op = opName(decoded)
  const kind = decoded?.kind
  const write = Boolean(
    decoded &&
      decoded.rd !== 0 &&
      (kind === 'alu' || kind === 'load' || kind === 'lui' || kind === 'auipc' || kind === 'jump' || kind === 'jalr' || op.startsWith('csr')),
  )
  return [
    { name: 'RegWrite', on: write, hint: '结果写入 rd。x0 永远不写。' },
    { name: 'ALUSrc', on: op === 'addi' || kind === 'load' || kind === 'store' || op === 'andi' || op === 'ori' || op === 'xori', hint: '第二操作数来自立即数。' },
    { name: 'MemRead', on: kind === 'load', hint: '按地址读内存或设备。' },
    { name: 'MemWrite', on: kind === 'store', hint: '按地址写内存或设备。' },
    { name: 'Branch', on: kind === 'branch', hint: '条件成立时，下址改为 PC 加偏移。' },
    { name: 'Jump', on: kind === 'jump' || kind === 'jalr', hint: '下址改为跳转目标。' },
    { name: 'ALUAdd', on: op === 'add' || op === 'addi' || kind === 'load' || kind === 'store', hint: '用加法器，进位输入为 0。' },
    { name: 'ALUSub', on: op === 'sub', hint: '同一组加法器，B 取反且进位输入为 1。' },
  ]
}

function BitRow({ label, bits }: { label: string; bits: number[] }) {
  return (
    <div className="bitrow">
      <span>{label}</span>
      <code>
        {bits.map((bit, index) => (
          <i key={`${label}-${index}`} className={bit ? 'one' : ''}>{bit}</i>
        ))}
      </code>
    </div>
  )
}

function Lamps({ lamps }: { lamps: Lamp[] }) {
  return (
    <div className="lamps">
      {lamps.map((lamp) => (
        <div key={lamp.name} className={lamp.on ? 'lamp on' : 'lamp'} title={lamp.hint}>
          <b>{lamp.name}</b>
          <span>{lamp.on ? '1' : '0'}</span>
          <small>{lamp.hint}</small>
        </div>
      ))}
    </div>
  )
}

function Adder({ trace, decoded }: { trace: Trace; decoded: Decoded }) {
  const op = opName(decoded)
  const address = decoded.kind === 'load' || decoded.kind === 'store'
  const subtract = op === 'sub'
  const add = op === 'add' || op === 'addi' || address
  if (!add && !subtract) {
    return (
      <p>
        这一拍的运算是 {op || '控制转移'}，ALU 结果 {hex(trace.alu)}。单步到 add、addi、sub，或 lw/sw 算地址时，这里会把进位逐位摊开。
      </p>
    )
  }
  const a = (trace.rs1v | 0) >>> 0
  const b = (subtract || op === 'add' ? trace.rs2v : decoded.imm) >>> 0
  const bIntoAdder = subtract ? (~b) >>> 0 : b
  const rows = ripple(a, bIntoAdder, subtract ? 1 : 0, WIDTH)
  const aName = regName(decoded.rs1)
  const bName = subtract || op === 'add' ? regName(decoded.rs2) : '立即数'
  const bit = WIDTH - 1
  const explain = `${rows.A[bit]} xor ${rows.B[bit]} xor ${rows.C[bit]} = ${rows.S[bit]}`
  return (
    <>
      <p>
        {subtract
          ? `${aName} − ${bName} 不做一套单独的减法电路。控制线 ALUSub 为 1 时，B 按位取反，最低位进位改为 1，也就是 A + (~B) + 1。`
          : address
            ? `访存地址是加法：${aName} + 立即数。ALUAdd 为 1，进位输入为 0。`
            : `${op} 把 ${aName} 和 ${bName} 送进同一组全加器。ALUAdd 为 1，进位输入为 0。`}
      </p>
      <p className="quiet">
        {hex(a)} {subtract ? '−' : '+'} {hex(subtract || op === 'add' ? trace.rs2v : decoded.imm)} = {hex(trace.alu)}。下面是低 {WIDTH} 位，高位用同样的全加器。
      </p>
      <BitRow label={aName} bits={rows.A} />
      <BitRow label={subtract ? `~${bName}` : bName} bits={rows.B} />
      <BitRow label="进位" bits={rows.C} />
      <BitRow label="结果" bits={rows.S} />
      <p>最低位：{explain}。进位输出是 A、B 和进位输入里至少有两位为 1，这三位的多数。</p>
    </>
  )
}

function CpuInside({ machine }: { machine: Machine | null }) {
  const trace = machine?.trace ?? null
  const decoded = trace && trace.instr ? decode(trace.instr) : null
  const lamps = controlLamps(trace?.trap ? null : decoded)
  return (
    <>
      <div className="blocks">
        {['程序计数器', '指令寄存器', '控制单元', '寄存器堆', '算术逻辑单元', '写回'].map((name) => (
          <div key={name}>{name}</div>
        ))}
      </div>
      <h3>这一拍的控制线</h3>
      {trace?.trap ? <p>这一拍是{trace.trap}，指令没有执行，上面的运算控制线保持 0。硬件改的是 mepc、mcause 和 PC。</p> : <Lamps lamps={lamps} />}
      <h3>加法器和减法</h3>
      {trace && decoded ? <Adder trace={trace} decoded={decoded} /> : <p>上电并单步之后，这里用当前指令的寄存器值展开进位。</p>}
    </>
  )
}

function BoardInside({ machine }: { machine: Machine | null }) {
  const addr = machine?.fault?.va ?? machine?.lastAccess?.addr ?? machine?.pc ?? 0
  const top = (addr >>> 28) & 0xf
  const lines = [
    { name: 'ROM_SEL', on: top === 0, hint: '高 4 位为 0，落到引导 ROM。' },
    { name: 'DEV_SEL', on: top === 1, hint: '高 4 位为 1，落到定时器、串口、键盘、显存。' },
    { name: 'DISK_SEL', on: top === 4, hint: '高 4 位为 4，落到磁盘窗口。' },
    { name: 'RAM_SEL', on: top === 8, hint: '高 4 位为 8，落到内存条。' },
  ]
  return (
    <>
      <p>译码器只看地址高 4 位，拉高一根选择线。同一拍只有一根为 1，数据才不会写进两颗零件。</p>
      <p className="quiet">本拍地址 {machine ? hex(addr) : '还没有'}，高 4 位是 {top.toString(16)}。</p>
      <Lamps lamps={lines} />
    </>
  )
}

function RamInside({ machine }: { machine: Machine | null }) {
  const addr = machine?.lastAccess?.addr
  const inRam = addr !== undefined && addr >= RAM_BASE && machine !== null && addr < RAM_BASE + machine.ramBytes
  const offset = inRam ? addr - RAM_BASE : 0
  return (
    <>
      <p>片选是主板的 RAM_SEL。选中之后，地址减去 0x80000000 就是这根内存条里的偏移。写使能跟着 MemWrite。</p>
      <Lamps lamps={[
        { name: 'RAM_SEL', on: Boolean(inRam || machine?.fault), hint: '高位译码命中内存。' },
        { name: 'WE', on: Boolean(machine?.lastAccess?.write && inRam), hint: '这一拍要写入。' },
      ]} />
      <p>{inRam ? `偏移 ${hex(offset)}，${machine?.lastAccess?.write ? '写入' : '读出'} ${machine?.lastAccess?.size} 字节。` : '这一拍的地址没有落到这根内存条。'}</p>
    </>
  )
}

function GpuInside({ machine }: { machine: Machine | null }) {
  const addr = machine?.lastAccess?.addr ?? 0
  const pixel = machine && addr >= FB_BASE ? (addr - FB_BASE) / 4 : null
  return (
    <>
      <p>显卡里有两套端口。CPU 的写端口把 sw 放进字符缓冲或显存。扫描端口按自己的行计数把已经写好的内容推上视频线，不占用 CPU 的指令。</p>
      <Lamps lamps={[
        { name: '写端口', on: machine?.lastAccess?.region === '串口' || machine?.lastAccess?.region === '显存', hint: 'CPU 正在写显示缓冲。' },
        { name: '扫描', on: Boolean(machine), hint: `当前扫描第 ${machine?.scanY ?? 0} 行。` },
      ]} />
      <p>
        {pixel !== null && machine?.lastAccess?.write
          ? `这一拍写的是第 ${pixel} 个像素。`
            : machine?.lastAccess?.region === '串口'
            ? `这一拍把低 8 位 ${hex((machine.trace?.memVal ?? 0) & 0xff)} 送进字符缓冲。`
            : '这一拍 CPU 没有写显卡。扫描仍在进行。'}
      </p>
    </>
  )
}

function Rest({ part, machine }: { part: Part; machine: Machine | null }) {
  if (part.category === 'psu') {
    return <p>电源内部是功率比较，不是运算器。额定 {machine?.ratedWatts ?? part.watts} W，已接入零件合计 {machine?.watts ?? 0} W。超过额定值时，复位控制线不会拉高。</p>
  }
  if (part.category === 'keyboard') {
    const code = machine?.lastKey ?? 0
    return (
      <>
        <p>矩阵先变成 8 位扫描码，再放到数据寄存器。中断线是另一根信号，读走数据后才落下。</p>
        <Lamps lamps={[
          { name: 'IRQ', on: Boolean(machine?.kbdIrq), hint: '有按键还没被读走。' },
          { name: 'Ready', on: Boolean(machine?.kbdReady), hint: '数据寄存器里有扫描码。' },
        ]} />
        <BitRow label="扫描码" bits={bitsOf(code, 8)} />
      </>
    )
  }
  if (part.category === 'disk') {
    const addr = machine?.lastAccess?.addr ?? 0
    const off = addr >= DISK_BASE ? addr - DISK_BASE : -1
    const field = off < 0 ? '这一拍没有读磁盘' : off < 4 ? '魔数' : off < 8 ? '装入地址' : off < 16 ? '长度' : '程序本体'
    return <p>窗口从 0x40000000 开始，只读。{off >= 0 ? `偏移 ${hex(off)} 落在${field}。` : field}。写使能在这颗零件上恒为 0。</p>
  }
  if (part.category === 'monitor') {
    return <p>显示器内部没有地址译码。它只接收显卡扫出来的第 {machine?.scanY ?? 0} 行。CPU 的 sw 到不了这里。</p>
  }
  return <p>{part.principle}</p>
}

export function PartDetail({
  part,
  machine,
  onClose,
}: {
  part: Part
  machine: Machine | null
  onClose: () => void
}) {
  return (
    <div className="overlay" onClick={onClose}>
      <article className="detail" onClick={(event) => event.stopPropagation()}>
        <header>
          <h2>{part.name}</h2>
          <button type="button" onClick={onClose}>关上</button>
        </header>
        <p>{part.role}</p>
        {part.category === 'cpu' && <CpuInside machine={machine} />}
        {part.category === 'board' && <BoardInside machine={machine} />}
        {part.category === 'ram' && <RamInside machine={machine} />}
        {part.category === 'gpu' && <GpuInside machine={machine} />}
        {part.category !== 'cpu' && part.category !== 'board' && part.category !== 'ram' && part.category !== 'gpu' && (
          <Rest part={part} machine={machine} />
        )}
      </article>
    </div>
  )
}
