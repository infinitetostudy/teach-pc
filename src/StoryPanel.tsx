import type { Machine } from './sim/machine'
import { controlStory, pcLine, type ImageKind } from './story'

export function StoryPanel({ machine, kind }: { machine: Machine | null; kind: ImageKind }) {
  const steps = controlStory(machine, kind)
  return (
    <section className="story">
      <h2>软件怎样让硬件动起来</h2>
      <p className="quiet">{pcLine(machine)}</p>
      <ol>
        {steps.map((step) => (
          <li key={step.title} className={step.state}>
            <b>{step.title}</b>
            {step.state === 'now' && <span>{step.detail}</span>}
          </li>
        ))}
      </ol>
    </section>
  )
}
