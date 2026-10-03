import { SLOTS, partById, type Assembly, type SlotId } from './catalog'
import type { Machine } from './sim/machine'
import { WIRES, activeWireIds, pathSentence, type WireId } from './wires'

const NODES: Record<SlotId, { x: number; y: number }> = {
  psu: { x: 78, y: 42 },
  cpu: { x: 250, y: 42 },
  board: { x: 250, y: 128 },
  keyboard: { x: 470, y: 42 },
  ram: { x: 78, y: 214 },
  gpu: { x: 250, y: 214 },
  disk: { x: 390, y: 214 },
  monitor: { x: 530, y: 214 },
}

export function Schematic({
  slots,
  machine,
  selected,
  onSelect,
}: {
  slots: Assembly
  machine: Machine | null
  selected: WireId | null
  onSelect: (id: WireId) => void
}) {
  const beat = new Set(activeWireIds(machine))
  const live = new Set<SlotId>()
  for (const wire of WIRES) {
    if (!beat.has(wire.id)) continue
    live.add(wire.from)
    live.add(wire.to)
  }
  const chosen = WIRES.find((wire) => wire.id === selected) ?? WIRES.find((wire) => beat.has(wire.id)) ?? WIRES[0]
  return (
    <section className="schematic">
      <h2>主板上的连接</h2>
      <p>{pathSentence(machine)}</p>
      <svg viewBox="0 0 600 250" role="img" aria-label="零件连接图">
        {WIRES.map((wire) => {
          const from = NODES[wire.from]
          const to = NODES[wire.to]
          const ready = Boolean(slots[wire.from] && slots[wire.to])
          const on = beat.has(wire.id)
          return (
            <g key={wire.id} className={on ? 'link on' : ready ? 'link' : 'link miss'} onClick={() => onSelect(wire.id)}>
              <line x1={from.x} y1={from.y} x2={to.x} y2={to.y} />
              <text x={(from.x + to.x) / 2} y={(from.y + to.y) / 2 - 6}>
                {wire.name}
              </text>
            </g>
          )
        })}
        {(Object.keys(NODES) as SlotId[]).map((id) => {
          const node = NODES[id]
          const part = partById(slots[id])
          const title = SLOTS.find((slot) => slot.id === id)?.title ?? id
          return (
            <g key={id} className={part ? (live.has(id) ? 'node on' : 'node') : 'node miss'}>
              <rect x={node.x - 46} y={node.y - 16} width="92" height="32" rx="8" />
              <text x={node.x} y={node.y + 4}>
                {part ? title : '空'}
              </text>
            </g>
          )
        })}
      </svg>
      <h3>{chosen.name}</h3>
      <p>{chosen.signal}。{chosen.principle}</p>
    </section>
  )
}
