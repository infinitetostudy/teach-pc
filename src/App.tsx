import { useEffect, useMemo, useRef, useState } from 'react'
import bootSrc from './firmware/boot.S?raw'
import kernelSrc from './firmware/kernel.S?raw'
import pageSrc from './firmware/pagefault.S?raw'
import { PARTS, PART_ART, SLOTS, partById, summarize, type Assembly, type Part, type SlotId } from './catalog'
import { PartDetail } from './detail'
import { liveNow } from './live'
import { PRESETS, type DiskKind } from './presets'
import { Schematic } from './Schematic'
import { StoryPanel } from './StoryPanel'
import type { ImageKind } from './story'
import { activeWireIds, slotsOnWires, type WireId } from './wires'
import { evaluatePost, postPassed, type PostStep } from './post'
import { AssembleError } from './sim/asm'
import { buildMachine } from './sim/build'
import { pressKey, runSteps, step } from './sim/cpu'
import { KERNEL_LOAD_SIZE, KEY_SRC, OK_SRC, PIXEL_SRC, assemblePayload, bootRom, kernelDisk, makeDisk } from './sim/images'
import { addressMap, regionName, type Machine } from './sim/machine'
import { INTRO_OPCODES, KMEM, POWER_ON_ORDER, RAM_BASE, fmtBytes, hex } from './spec'

type Phase = 'build' | 'post' | 'run'
type PageId = 'assemble' | 'power' | 'run' | 'learn' | 'code'

const PAGES: { id: PageId; label: string }[] = [
  { id: 'assemble', label: '组装' },
  { id: 'power', label: '上电' },
  { id: 'run', label: '运行' },
  { id: 'learn', label: '原理' },
  { id: 'code', label: '编程' },
]

function readPage(): PageId {
  const id = window.location.hash.slice(1)
  return PAGES.some((item) => item.id === id) ? (id as PageId) : 'assemble'
}

const GROUPS: { title: string; category: Part['category'] }[] = [
  { title: '主板', category: 'board' },
  { title: 'CPU', category: 'cpu' },
  { title: '内存', category: 'ram' },
  { title: '显卡', category: 'gpu' },
  { title: '电源', category: 'psu' },
  { title: '显示器', category: 'monitor' },
  { title: '键盘', category: 'keyboard' },
  { title: '磁盘', category: 'disk' },
]

function readWord(machine: Machine, addr: number): number {
  const off = addr - RAM_BASE
  if (off < 0 || off + 4 > machine.ram.length) return 0
  const b = machine.ram
  return (b[off] | (b[off + 1] << 8) | (b[off + 2] << 16) | (b[off + 3] << 24)) >>> 0
}

export function App() {
  const images = useMemo(() => {
    const rom = bootRom(bootSrc)
    return {
      rom,
      ok: makeDisk(assemblePayload(OK_SRC)),
      pixel: makeDisk(assemblePayload(PIXEL_SRC)),
      key: makeDisk(assemblePayload(KEY_SRC)),
      kernel: kernelDisk(kernelSrc),
      page: makeDisk(assemblePayload(pageSrc)),
      sources: { ok: OK_SRC, pixel: PIXEL_SRC, key: KEY_SRC, kernel: kernelSrc, page: pageSrc } as Record<DiskKind, string>,
    }
  }, [])

  const diskRef = useRef(images.ok)
  const simRef = useRef<Machine | null>(null)
  const [slots, setSlots] = useState<Assembly>({})
  const [selected, setSelected] = useState<string | null>(null)
  const [held, setHeld] = useState<string | null>(null)
  const [ghost, setGhost] = useState<{ id: string; x: number; y: number; slot: SlotId | null } | null>(null)
  const dragRef = useRef<{ id: string; moved: boolean; x: number; y: number } | null>(null)
  const [note, setNote] = useState('从左边拿起零件，放进对应的槽。也可以直接装入一套固定配置。')
  const [phase, setPhase] = useState<Phase>('build')
  const [postSteps, setPostSteps] = useState<PostStep[]>([])
  const [revealed, setRevealed] = useState(0)
  const [machine, setMachine] = useState<Machine | null>(null)
  const [running, setRunning] = useState(false)
  const [diskName, setDiskName] = useState('终端程序 OK')
  const [diskKind, setDiskKind] = useState<ImageKind>('ok')
  const [wireId, setWireId] = useState<WireId | null>(null)
  const [editor, setEditor] = useState(OK_SRC)
  const [editorError, setEditorError] = useState('')
  const [specOpen, setSpecOpen] = useState(false)
  const [detailOpen, setDetailOpen] = useState(false)
  const [page, setPage] = useState<PageId>(readPage)
  const summary = summarize(slots)
  const part = partById(selected ?? undefined)
  simRef.current = machine

  useEffect(() => {
    const sync = () => setPage(readPage())
    window.addEventListener('hashchange', sync)
    return () => window.removeEventListener('hashchange', sync)
  }, [])

  function openPage(id: PageId) {
    if (window.location.hash.slice(1) !== id) window.location.hash = id
    setPage(id)
  }

  useEffect(() => {
    if (!running) return
    let alive = true
    let frame = 0
    const loop = () => {
      if (!alive) return
      const cur = simRef.current
      if (!cur || cur.halted) {
        setRunning(false)
        return
      }
      const next = runSteps(cur, 5000)
      simRef.current = next
      setMachine(next)
      frame = requestAnimationFrame(loop)
    }
    frame = requestAnimationFrame(loop)
    return () => {
      alive = false
      cancelAnimationFrame(frame)
    }
  }, [running])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLInputElement) return
      if (phase !== 'run' || !simRef.current) return
      if (event.key.length !== 1) return
      const next = pressKey(simRef.current, event.key.charCodeAt(0))
      simRef.current = next
      setMachine(next)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [phase])

  function powerOff() {
    setRunning(false)
    setPhase('build')
    setMachine(null)
    setPostSteps([])
    setRevealed(0)
  }

  function slotUnder(x: number, y: number): SlotId | null {
    const raw = document.elementFromPoint(x, y)?.closest('[data-slot]')?.getAttribute('data-slot')
    return SLOTS.some((slot) => slot.id === raw) ? (raw as SlotId) : null
  }

  function pointerDown(event: React.PointerEvent<HTMLButtonElement>, id: string) {
    if (event.button !== 0) return
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      /* 有些拖放事件拿不到指针捕获，移动监听仍在按钮上。 */
    }
    dragRef.current = { id, moved: false, x: event.clientX, y: event.clientY }
    setSelected(id)
    setGhost({ id, x: event.clientX, y: event.clientY, slot: null })
  }

  function finishDrag(event: { clientX: number; clientY: number }) {
    const drag = dragRef.current
    if (!drag) return
    dragRef.current = null
    const far = Math.hypot(event.clientX - drag.x, event.clientY - drag.y) > 6
    const slot = far || drag.moved ? slotUnder(event.clientX, event.clientY) : null
    setGhost(null)
    if (slot) {
      install(drag.id, slot)
      return
    }
    setHeld(drag.id)
    setSelected(drag.id)
  }

  useEffect(() => {
    const move = (event: PointerEvent) => {
      const drag = dragRef.current
      if (!drag) return
      if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) > 6) drag.moved = true
      setGhost({ id: drag.id, x: event.clientX, y: event.clientY, slot: slotUnder(event.clientX, event.clientY) })
    }
    const up = (event: PointerEvent) => finishDrag(event)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
    }
  })

  function install(partId: string, slot: SlotId) {
    const item = partById(partId)
    if (!item) return
    if (item.category !== slot) {
      const from = SLOTS.find((s) => s.id === item.category)?.title ?? item.category
      const to = SLOTS.find((s) => s.id === slot)?.title ?? slot
      setNote(`${item.name} 应该装进 ${from}，不能装进 ${to}。`)
      return
    }
    setSlots((prev) => ({ ...prev, [slot]: partId }))
    setSelected(partId)
    setHeld(null)
    setNote(`${item.name} 已装入 ${SLOTS.find((s) => s.id === slot)?.title}。`)
    powerOff()
  }

  function removeSlot(slot: SlotId) {
    setSlots((prev) => {
      const next = { ...prev }
      delete next[slot]
      return next
    })
    setNote(`${SLOTS.find((s) => s.id === slot)?.title} 已清空。`)
    powerOff()
  }

  function applyPreset(id: string) {
    const preset = PRESETS.find((item) => item.id === id)
    if (!preset) return
    const bytes = images[preset.disk]
    diskRef.current = bytes
    setSlots(preset.slots)
    setDiskName(preset.name)
    setDiskKind(preset.disk)
    setEditor(images.sources[preset.disk])
    setEditorError('')
    setSelected(preset.slots.cpu ?? preset.slots.board ?? null)
    setHeld(null)
    setNote(preset.detail)
    powerOff()
  }

  function writeEditor() {
    try {
      const payload = assemblePayload(editor)
      diskRef.current = makeDisk(payload)
      setDiskName('编辑器里的程序')
      setDiskKind('custom')
      setEditorError('')
      setNote(`已写入磁盘，程序 ${payload.length} 字节。重新上电后引导 ROM 会装入它。`)
    } catch (error) {
      setEditorError(error instanceof AssembleError ? error.message : '汇编失败')
    }
  }

  function loadImage(kind: DiskKind, name: string) {
    diskRef.current = images[kind]
    setDiskName(name)
    setDiskKind(kind)
    setEditor(images.sources[kind])
    setEditorError('')
    setNote(kind === 'kernel'
      ? `内核镜像 ${KERNEL_LOAD_SIZE / 1024} KiB，比 64 KiB 内存大。装好后重新上电。`
      : `${name} 已写入磁盘。重新上电后生效。`)
  }

  function powerOn() {
    const steps = evaluatePost(slots)
    setPostSteps(steps)
    setRevealed(1)
    setPhase('post')
    setMachine(null)
    setRunning(false)
    setNote(steps[0]?.ok ? '这一步通过了。继续自检会停在下一步。' : '上电停在这一步。点对应零件可以看原因。')
  }

  function continuePost() {
    if (phase !== 'post' || revealed === 0) return
    const current = postSteps[revealed - 1]
    if (!current?.ok) return
    const nextCount = revealed + 1
    setRevealed(nextCount)
    if (nextCount === postSteps.length && postPassed(postSteps)) {
      const built = buildMachine(slots, diskRef.current, images.rom)
      simRef.current = built
      setMachine(built)
      setPhase('run')
      setNote('CPU 已复位，程序计数器指向引导 ROM。可以单步，也可以连续运行。')
      openPage('run')
    }
  }

  function reboot() {
    const steps = evaluatePost(slots)
    setPostSteps(steps)
    setRevealed(steps.length)
    setRunning(false)
    if (postPassed(steps)) {
      const built = buildMachine(slots, diskRef.current, images.rom)
      simRef.current = built
      setMachine(built)
      setPhase('run')
      setNote('CPU 已重新复位到引导 ROM。')
    } else {
      setMachine(null)
      setPhase('post')
      setNote('这套零件过不了自检，机器没有取指。')
    }
  }

  function oneStep() {
    setRunning(false)
    setMachine((cur) => {
      if (!cur) return cur
      const next = step(cur)
      simRef.current = next
      return next
    })
  }

  const failedStep = postSteps.slice(0, revealed).find((item) => !item.ok)
  const map = machine ? addressMap(machine) : []
  const activeRegion = machine?.lastAccess?.region

  const runMachine = phase === 'run' ? machine : null

  return (
    <div className="app">
      <header className="top">
        <div>
          <p className="eyebrow">RV32I 教学机</p>
          <h1>从零件装到能跑的计算机</h1>
        </div>
        <button type="button" onClick={() => setSpecOpen(true)}>机器规格</button>
      </header>
      <nav className="nav">
        {PAGES.map((item) => (
          <button key={item.id} type="button" className={page === item.id ? 'on' : ''} onClick={() => openPage(item.id)}>
            {item.label}
          </button>
        ))}
        <span className="nav-status">{phase === 'run' ? '已复位，可以运行' : phase === 'post' ? '正在自检' : '还没有上电'}</span>
      </nav>

      {page === 'assemble' && (
        <div className="page page-assemble">
          <aside className="bin">
            <p className="bin-note">{ghost ? '拖到机箱槽位上松开。' : held ? `手上拿着 ${partById(held)?.name}。点一个槽位放下。` : '按住零件图片拖进机箱，或点一下再点槽位。'}</p>
            {GROUPS.map((group) => (
              <section key={group.category}>
                <h2>{group.title}</h2>
                {PARTS.filter((item) => item.category === group.category).map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={held === item.id || selected === item.id ? 'part on' : 'part'}
                    onPointerDown={(event) => pointerDown(event, item.id)}
                  >
                    <img src={PART_ART[item.category]} alt="" draggable={false} />
                    <span>
                      <strong>{item.name}</strong>
                      <small>{item.watts ? `${item.watts} W` : item.ramBytes ? fmtBytes(item.ramBytes) : item.width ? `${item.width}×${item.height}` : '插槽零件'}</small>
                    </span>
                  </button>
                ))}
              </section>
            ))}
          </aside>
          <main className="bench">
            <div className="preset-row">
              {PRESETS.map((preset) => (
                <button key={preset.id} type="button" onClick={() => applyPreset(preset.id)}>{preset.name}</button>
              ))}
            </div>
            <p className="note">{note}</p>
            <section className="chassis">
              {SLOTS.map((slot) => {
                const item = partById(slots[slot.id])
                return (
                  <div
                    key={slot.id}
                    data-slot={slot.id}
                    className={[
                      'slot',
                      item ? 'filled' : '',
                      ghost?.slot === slot.id ? (partById(ghost.id)?.category === slot.id ? 'hot' : 'bad') : '',
                    ].filter(Boolean).join(' ')}
                    onClick={() => {
                      if (held) install(held, slot.id)
                      else if (item) {
                        setSelected(item.id)
                        openPage('learn')
                      }
                    }}
                  >
                    <span>{slot.title}</span>
                    {item && <img src={PART_ART[item.category]} alt="" />}
                    <strong>{item ? item.name : '空'}</strong>
                    <small>{item ? '' : slot.hint}</small>
                    {item && (
                      <button
                        type="button"
                        className="tiny"
                        onClick={(event) => {
                          event.stopPropagation()
                          removeSlot(slot.id)
                        }}
                      >
                        卸下
                      </button>
                    )}
                  </div>
                )
              })}
            </section>
            <dl className="summary">
              <div><dt>功耗</dt><dd>{summary.watts} W / 电源 {summary.psuWatts || 0} W</dd></div>
              <div><dt>内存</dt><dd>{summary.ramBytes ? fmtBytes(summary.ramBytes) : '未安装'}</dd></div>
              <div><dt>最高输出</dt><dd>{summary.video}</dd></div>
              <div><dt>磁盘</dt><dd>{diskName}</dd></div>
            </dl>
          </main>
        </div>
      )}

      {page === 'power' && (
        <main className="page page-power">
          <div className="preset-row">
            <button type="button" onClick={powerOn}>上电</button>
            <button type="button" onClick={continuePost} disabled={phase !== 'post' || Boolean(failedStep) || revealed >= postSteps.length}>
              继续自检
            </button>
            <button type="button" onClick={reboot} disabled={Object.keys(slots).length === 0}>重新上电</button>
          </div>
          <p className="note">{note}</p>
          <section className="post">
            <h2>上电自检</h2>
            {postSteps.length === 0 && <p className="quiet">装好零件后按上电。每一步都会停住，通过才进入下一步。</p>}
            <ol>
              {postSteps.map((item, index) => {
                const shown = index < revealed
                return (
                  <li key={item.id} className={!shown ? 'wait' : item.ok ? 'ok' : 'bad'}>
                    <b>{item.title}</b>
                    <span>{shown ? item.detail : '等上一步结束'}</span>
                  </li>
                )
              })}
            </ol>
          </section>
        </main>
      )}

      {page === 'run' && (
        <div className="page page-run">
          <main className="bench">
            <div className="preset-row">
              <button type="button" onClick={oneStep} disabled={phase !== 'run'}>单步</button>
              <button type="button" onClick={() => setRunning((value) => !value)} disabled={phase !== 'run'}>
                {running ? '暂停' : '运行'}
              </button>
              <button type="button" onClick={reboot} disabled={Object.keys(slots).length === 0}>重新上电</button>
            </div>
            <Screen machine={machine} phase={phase} failed={failedStep?.detail ?? ''} />
          </main>
          <aside className="side">
            <article className="card">
              <h2>数据通路</h2>
              <Datapath machine={runMachine} />
            </article>
          </aside>
        </div>
      )}

      {page === 'learn' && (
        <div className="page page-learn">
          <Schematic slots={slots} machine={runMachine} selected={wireId} onSelect={setWireId} />
          <article className="card">
            <h2>
              {part ? part.name : '零件原理'}
              {part && <button type="button" className="tiny" onClick={() => setDetailOpen(true)}>详细</button>}
            </h2>
            {part ? (
              <>
                <img className="explain-art" src={PART_ART[part.category]} alt="" />
                <h3>作用</h3>
                <p>{part.role}</p>
                <h3>原理</h3>
                <p>{part.principle}</p>
                <h3>和谁相连</h3>
                <p>{part.links}</p>
                <h3>此刻</h3>
                <p>{liveNow(part, slots, runMachine)}</p>
              </>
            ) : (
              <p>在组装页点一个已经装上的零件，或在这里从下面选一颗。详细里能看到控制线和加减法。</p>
            )}
            <div className="part-picks">
              {SLOTS.map((slot) => {
                const item = partById(slots[slot.id])
                if (!item) return null
                const live = slotsOnWires(activeWireIds(runMachine)).includes(slot.id)
                return (
                  <button key={slot.id} type="button" className={selected === item.id ? 'on' : ''} onClick={() => setSelected(item.id)}>
                    {item.name}{live ? ' · 这一拍' : ''}
                  </button>
                )
              })}
            </div>
            {part?.category === 'board' && machine && (
              <>
                <h3>地址图</h3>
                <ul className="map">
                  {map.map((seg) => (
                    <li key={seg.name} className={activeRegion === seg.name ? 'hit' : ''}>
                      <b>{seg.name}</b>
                      <span>{seg.end > seg.start ? `${hex(seg.start)} – ${hex(seg.end)}` : '这一配置没有这段'}</span>
                    </li>
                  ))}
                </ul>
                <p>本拍落在{activeRegion ?? '还没有访问'}。</p>
              </>
            )}
          </article>
          <StoryPanel machine={runMachine} kind={diskKind} />
        </div>
      )}

      {page === 'code' && (
        <main className="page page-code">
          <section className="editor">
            <div className="editor-bar">
              <h2>写程序并写入磁盘</h2>
              <button type="button" onClick={writeEditor}>汇编并写入磁盘</button>
              <button type="button" onClick={() => loadImage('ok', '终端程序 OK')}>终端示例</button>
              <button type="button" onClick={() => loadImage('pixel', '画块程序')}>画块程序</button>
              <button type="button" onClick={() => loadImage('key', '键盘程序')}>键盘程序</button>
              <button type="button" onClick={() => loadImage('kernel', '内核')}>载入内核</button>
              <button type="button" onClick={() => loadImage('page', '缺页演示')}>缺页演示</button>
            </div>
            <p className="note">写入后到「上电」页重新上电，引导程序才会装入新的磁盘内容。</p>
            <textarea value={editor} onChange={(event) => setEditor(event.target.value)} spellCheck={false} aria-label="汇编程序" />
            {editorError && <p className="error">{editorError}</p>}
          </section>
        </main>
      )}

      {ghost && partById(ghost.id) && (
        <div className="ghost" style={{ left: ghost.x, top: ghost.y }}>
          <img src={PART_ART[partById(ghost.id)!.category]} alt="" />
          <span>{partById(ghost.id)!.name}</span>
        </div>
      )}

      {detailOpen && part && (
        <PartDetail part={part} machine={phase === 'run' ? machine : null} onClose={() => setDetailOpen(false)} />
      )}

      {specOpen && (
        <div className="overlay" onClick={() => setSpecOpen(false)}>
          <article className="spec" onClick={(event) => event.stopPropagation()}>
            <h2>机器规格</h2>
            <p>指令集固定为 RV32I。换 CPU、内存、显卡只改变容量、功耗和能不能接上，已经写好的程序仍从引导 ROM 启动。</p>
            <h3>先讲清的指令</h3>
            <p>{INTRO_OPCODES.join('  ')}</p>
            <p>操作系统还会用到移位、比较、ecall、机器态 CSR 和 mret。这些仍然是这台机器的指令，不是另一套指令集。</p>
            <h3>地址</h3>
            <ul>
              <li>0x00000000 引导 ROM，4 KiB，复位后的程序计数器</li>
              <li>0x10000000 定时器</li>
              <li>0x10001000 串口 / 字符终端</li>
              <li>0x10002000 键盘</li>
              <li>0x10003000 机器信息：内存容量、帧缓冲宽高</li>
              <li>0x10010000 显存，长度由显卡决定</li>
              <li>0x40000000 磁盘窗口，只读</li>
              <li>0x80000000 内存，内核装在这里，长度由内存条决定</li>
            </ul>
            <h3>上电顺序</h3>
            <ol>{POWER_ON_ORDER.map((line) => <li key={line}>{line}</li>)}</ol>
            <button type="button" onClick={() => setSpecOpen(false)}>关上</button>
          </article>
        </div>
      )}
    </div>
  )
}

function Screen({ machine, phase, failed }: { machine: Machine | null; phase: Phase; failed: string }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = ref.current
    if (!canvas || !machine || machine.gpuMode !== 'fb') return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const image = ctx.createImageData(machine.fbWidth, machine.fbHeight)
    const fb = machine.fb
    for (let i = 0, p = 0; i < fb.length; i += 4, p += 4) {
      image.data[p] = fb[i + 2]
      image.data[p + 1] = fb[i + 1]
      image.data[p + 2] = fb[i]
      image.data[p + 3] = 255
    }
    ctx.putImageData(image, 0, 0)
  }, [machine])

  const ticks = machine ? readWord(machine, KMEM.ticks) : 0
  const thread = machine ? readWord(machine, KMEM.current) : 0
  const sig0 = machine ? readWord(machine, KMEM.sig0) : 0
  const sig1 = machine ? readWord(machine, KMEM.sig1) : 0

  return (
    <section className="screen-wrap">
      <h2>显示器</h2>
      {phase !== 'run' && <p className="quiet">{failed || '上电走完之前，显示器没有信号。'}</p>}
      {phase === 'run' && machine?.gpuMode === 'text' && <pre className="crt">{machine.text || ' '}<span className="cursor"> </span></pre>}
      {phase === 'run' && machine?.gpuMode === 'fb' && (
        <>
          <canvas ref={ref} width={machine.fbWidth} height={machine.fbHeight} />
          <pre className="crt small">{machine.text || '（串口还没有字符）'}</pre>
        </>
      )}
      {machine && (
        <p className="status">
          周期 {machine.cycle} · PC {hex(machine.pc)} · {machine.priv} 态
          {machine.halted ? ` · 停机：${machine.haltReason}` : ''}
          {(ticks > 0 || machine.text.includes('HI')) && ` · 定时器 ${ticks} · 线程 ${thread} · 计数 ${sig0}/${sig1}`}
          {machine.gpuMode === 'fb' && ` · 扫描行 ${machine.scanY}`}
        </p>
      )}
    </section>
  )
}

function Datapath({ machine }: { machine: Machine | null }) {
  const trace = machine?.trace
  const regs = machine?.regs ?? []
  return (
    <>
      <div className="path">
        <div>
          <h3>取指</h3>
          <p>{trace ? `${hex(trace.pc)}  ${trace.asm}` : '等待时钟'}</p>
        </div>
        <div>
          <h3>译码</h3>
          <p>{trace ? `rd x${trace.rd}  rs1=${hex(trace.rs1v)}  rs2=${hex(trace.rs2v)}` : '—'}</p>
        </div>
        <div>
          <h3>执行</h3>
          <p>{trace ? `ALU ${hex(trace.alu)}${trace.trap ? ` · ${trace.trap}` : ''}` : '—'}</p>
        </div>
        <div>
          <h3>写回</h3>
          <p>
            {trace
              ? `${trace.wb !== null ? hex(trace.wb) : '不写寄存器'}${trace.memAddr !== null ? ` · 地址 ${hex(trace.memAddr)}` : ''}`
              : '—'}
          </p>
        </div>
      </div>
      {machine && (
        <>
          <p className="quiet">本拍地址段：{machine.lastAccess ? `${machine.lastAccess.region} ${hex(machine.lastAccess.addr)}` : regionName(machine, machine.pc)}</p>
          <div className="regs">
            {regs.map((value, index) => (
              <span key={index} className={trace?.rd === index && trace.wb !== null ? 'wb' : ''}>
                x{index} {hex(value, 8)}
              </span>
            ))}
          </div>
          <ol className="hist">
            {machine.history.slice(-6).map((line, index) => <li key={`${line}-${index}`}>{line}</li>)}
          </ol>
        </>
      )}
    </>
  )
}
