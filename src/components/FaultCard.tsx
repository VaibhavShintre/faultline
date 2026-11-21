import { useEffect, useRef, useState } from 'react'
import { type AiStatus, type Tutor, createTutor, faultPrompt } from '../ai'
import type { Analysis } from '../engine/analyze'
import { CATALOG, explain } from '../engine/catalog'
import type { MisconceptionId } from '../engine/malrules'
import { hasTargetedPractice } from '../engine/practice'
import { Crack } from './StepEditor'
import { Rich, Tex } from './Tex'

interface Props {
  analysis: Analysis
  ai: AiStatus
  onEnableAi: () => void
  onPractice?: (skill: MisconceptionId) => void
}

export function FaultCard({ analysis, ai, onEnableAi, onPractice }: Props) {
  const [revealed, setRevealed] = useState(false)
  const fault = analysis.steps[analysis.faultIndex!]
  const d = fault.diagnosis!
  const info = CATALOG[d.id]
  const prev = analysis.steps.filter((s) => s.index < fault.index && (s.status === 'ok' || s.status === 'start')).pop()
  const cx = fault.counterexample
  const at = cx
    ? Object.entries(cx.at)
        .map(([k, v]) => `${k} = ${v}`)
        .join(', ')
    : ''

  // A new fault starts with the corrected step hidden again.
  const faultKey = `${prev?.raw}|${fault.raw}`
  useEffect(() => setRevealed(false), [faultKey])

  return (
    <article className="card fault-card" aria-live="polite">
      <header className="fault-head">
        <span className="eyebrow eyebrow-fault">
          <Crack /> Fault line at line {fault.index + 1}
        </span>
        <h2>{info.name}</h2>
        <p className="belief">The idea behind it: “{info.belief}”</p>
      </header>

      <div className="break">
        <div className="break-line break-ok">
          <span className="break-tag">Line {prev ? prev.index + 1 : 1}</span>
          <Tex tex={prev?.tex ?? ''} block />
        </div>
        <svg className="break-crack" viewBox="0 0 400 18" preserveAspectRatio="none" aria-hidden="true">
          <path d="M0 9 H120 l14 -7 12 13 14 -11 10 9 12 -6 H400" fill="none" stroke="currentColor" strokeWidth="1.5" />
        </svg>
        <div className="break-line break-bad">
          <span className="break-tag">Line {fault.index + 1}</span>
          <Tex tex={fault.tex ?? ''} block />
        </div>
      </div>

      <section>
        <h3>What happened</h3>
        <p>
          <Rich text={explain(d, revealed)} />
        </p>
        {d.right && !revealed && (
          <button className="link" onClick={() => setRevealed(true)}>
            Show me the corrected step
          </button>
        )}
      </section>

      {cx && (
        <section className="check">
          <h3>Check it with a number</h3>
          <p>
            Put <strong>{at}</strong> into both lines: {cx.prevSays}, but {cx.curSays}. Two lines that say the same thing can never disagree like that.
          </p>
        </section>
      )}

      <section>
        <h3>The rule</h3>
        <p>{info.principle}</p>
      </section>

      <TutorPanel key={faultKey} analysis={analysis} ai={ai} onEnableAi={onEnableAi} />

      {onPractice && (
        <footer className="card-actions">
          <button className="btn btn-primary" onClick={() => onPractice(d.id)}>
            {hasTargetedPractice(d.id) ? 'Practise this exact mistake' : 'Practise a similar problem'}
          </button>
        </footer>
      )}
    </article>
  )
}

interface Turn {
  who: 'tutor' | 'you'
  text: string
}

function TutorPanel({ analysis, ai, onEnableAi }: Pick<Props, 'analysis' | 'ai' | 'onEnableAi'>) {
  const [turns, setTurns] = useState<Turn[]>([])
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const [question, setQuestion] = useState('')
  const tutor = useRef<Tutor | null>(null)

  const speak = async (prompt: string) => {
    setBusy(true)
    setTurns((t) => [...t, { who: 'tutor', text: '' }])
    try {
      tutor.current ??= await createTutor()
      await tutor.current.say(prompt, (text) => setTurns((t) => [...t.slice(0, -1), { who: 'tutor', text }]))
    } catch {
      setFailed(true)
      setTurns((t) => t.slice(0, -1))
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    if (ai !== 'ready') return
    let cancelled = false
    // Strict mode mounts twice in development; wait a tick so only the live mount speaks.
    const timer = setTimeout(() => {
      if (!cancelled) void speak(faultPrompt(analysis.steps, analysis.faultIndex!))
    }, 50)
    return () => {
      cancelled = true
      clearTimeout(timer)
      tutor.current?.destroy()
      tutor.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ai])

  const ask = (e: React.FormEvent) => {
    e.preventDefault()
    const q = question.trim()
    if (!q || busy) return
    setQuestion('')
    setTurns((t) => [...t, { who: 'you', text: q }])
    void speak(`The student asks: "${q}"\nAnswer using the FACTS above. Do not give the final answer to the problem.`)
  }

  if (ai === 'unavailable' || failed)
    return (
      <section className="tutor tutor-off">
        <h3>Tutor</h3>
        <p className="muted">
          The explanation above comes from Faultline’s built-in rule library, which works in every browser. The conversational tutor uses the on-device model in
          desktop Chrome, so nothing you type is sent anywhere.
        </p>
      </section>
    )

  if (ai === 'downloadable' || ai === 'downloading')
    return (
      <section className="tutor tutor-off">
        <h3>Tutor</h3>
        <p className="muted">Chrome can run the tutor’s language model on this device. It downloads once and then works offline.</p>
        <button className="btn" onClick={onEnableAi} disabled={ai === 'downloading'}>
          {ai === 'downloading' ? 'Downloading the model…' : 'Turn on the on-device tutor'}
        </button>
      </section>
    )

  return (
    <section className="tutor">
      <h3>
        Tutor <span className="pill pill-ai">on-device AI</span>
      </h3>
      <div className="turns">
        {turns.map((t, i) => (
          <p key={i} className={`turn turn-${t.who}`}>
            {t.text || <span className="typing" aria-label="The tutor is thinking" />}
          </p>
        ))}
        {ai === 'checking' && <p className="muted">Looking for an on-device model…</p>}
      </div>
      <form className="ask" onSubmit={ask}>
        <input value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Ask why, or say what you were thinking" aria-label="Ask the tutor a question" />
        <button className="btn" disabled={busy || !question.trim()}>
          Ask
        </button>
      </form>
    </section>
  )
}
