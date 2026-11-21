import { useEffect, useRef, useState } from 'react'
import { type AiStatus, type GuardedReply, type Tutor, createTutor, faultPrompt, followUpPrompt, guardedSay } from '../ai'
import type { Analysis } from '../engine/analyze'
import { CATALOG, explain } from '../engine/catalog'
import type { MisconceptionId } from '../engine/malrules'
import { hasTargetedPractice } from '../engine/practice'
import { guardContext } from '../guard'
import { Crack } from './StepEditor'
import { Rich, Tex } from './Tex'

interface Props {
  analysis: Analysis
  /** Which mistake to show: an index into `analysis.steps`. Defaults to the fault line. */
  index?: number
  ai: AiStatus
  onEnableAi: () => void
  onPractice?: (skill: MisconceptionId) => void
}

const list = (nums: number[]) => (nums.length <= 2 ? nums.join(' and ') : `${nums.slice(0, -1).join(', ')} and ${nums[nums.length - 1]}`)

/** One sentence per kind of line that comes after the fault line. */
function AfterTheFault({ analysis }: { analysis: Analysis }) {
  const fault = analysis.steps[analysis.faultIndex!]
  const later = analysis.steps.filter((s) => s.index > fault.index && s.line)
  if (!later.length) return null
  const of = (status: string) => later.filter((s) => s.status === status).map((s) => s.index + 1)
  const [carried, second, recovered] = [of('carried'), of('second-fault'), of('recovered')]
  const after = later.filter((s) => s.status === 'ok').map((s) => s.index + 1)
  if (!carried.length && !second.length && !recovered.length) return null
  return (
    <section className="after">
      <h3>After the fault line</h3>
      <ul>
        {carried.length > 0 && (
          <li className="after-carried">
            <strong>
              {carried.length === 1 ? 'Line' : 'Lines'} {list(carried)}
            </strong>{' '}
            {carried.length === 1 ? 'follows' : 'follow'} correctly from the line above. Your method there is sound, it just started from a wrong line: fix line{' '}
            {fault.index + 1} and redo {carried.length === 1 ? 'it' : 'them'}.
          </li>
        )}
        {second.length > 0 && (
          <li className="after-second">
            <strong>
              {second.length === 1 ? 'Line' : 'Lines'} {list(second)}
            </strong>{' '}
            {second.length === 1 ? 'is a second, separate mistake' : 'are further, separate mistakes'}, shown below.
          </li>
        )}
        {recovered.length > 0 && (
          <li className="after-recovered">
            <strong>Line {list(recovered)}</strong> agrees with the correct working again, so you are back on track from there
            {after.length > 0 ? ` and line${after.length === 1 ? '' : 's'} ${list(after)} ${after.length === 1 ? 'follows' : 'follow'}` : ''}.
          </li>
        )}
      </ul>
    </section>
  )
}

export function FaultCard({ analysis, index, ai, onEnableAi, onPractice }: Props) {
  const [revealed, setRevealed] = useState(false)
  const first = index === undefined || index === analysis.faultIndex
  const fault = analysis.steps[index ?? analysis.faultIndex!]
  const d = fault.diagnosis!
  const info = CATALOG[d.id]
  const prev = analysis.steps[fault.against ?? 0]
  const cx = fault.counterexample
  const at = cx?.atText ?? ''

  // A new fault starts with the corrected step hidden again.
  const faultKey = `${prev?.raw}|${fault.raw}`
  useEffect(() => setRevealed(false), [faultKey])

  return (
    <article className={`card fault-card ${first ? '' : 'fault-card-second'}`} aria-live="polite">
      <header className="fault-head">
        <span className="eyebrow eyebrow-fault">
          <Crack /> {first ? 'Fault line' : 'Second mistake'} at line {fault.index + 1}
        </span>
        <h2>{info.name}</h2>
        <p className="belief">The idea behind it: “{info.belief}”</p>
      </header>

      <div className="break">
        <div className={`break-line ${first ? 'break-ok' : 'break-off'}`}>
          <span className="break-tag">
            Line {prev.index + 1}
            {!first && ' (already off)'}
          </span>
          <Tex tex={prev.tex ?? ''} block />
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
          {!first && `Even starting from line ${prev.index + 1} as you wrote it, this line does not follow. `}
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

      {first && <AfterTheFault analysis={analysis} />}

      {first && <TutorPanel key={faultKey} analysis={analysis} ai={ai} onEnableAi={onEnableAi} />}

      {onPractice && (
        <footer className="card-actions">
          <button className={`btn ${first ? 'btn-primary' : ''}`} onClick={() => onPractice(d.id)}>
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
  /** How the engine's check of this reply went. Absent while the reply is still streaming. */
  check?: Pick<GuardedReply, 'outcome' | 'notes' | 'checked'>
  /** Why a draft was rejected, in words. */
  reason?: string
}

const WHY: Record<string, string> = {
  'answer-leak': 'it gave away the answer',
  'false-arithmetic': 'it contained arithmetic that is wrong',
  'foreign-number': 'it used a number that is not in your working',
}

function CheckNote({ check, reason }: { check: NonNullable<Turn['check']>; reason: string }) {
  if (check.outcome === 'withheld')
    return (
      <p className="turn-check turn-check-warn">
        The tutor’s reply is not shown: twice in a row {reason || 'it failed the check'}. Everything above this panel comes from the exact checker and still stands.
      </p>
    )
  const unconfirmed = check.notes.filter((n) => n.kind === 'unverified-equation')
  const text =
    (check.outcome === 'rewritten' ? `A first draft was thrown away because ${reason || 'it failed the check'}. ` : '') +
    (unconfirmed.length > 0
      ? `The checker could not confirm “${unconfirmed[0].quote}” in this reply. Trust the marked lines over the tutor’s wording.`
      : check.checked > 0
        ? `✓ ${check.checked === 1 ? 'The equation' : `All ${check.checked} equations`} in this reply ${check.checked === 1 ? 'was' : 'were'} checked by the symbolic engine.`
        : check.outcome === 'rewritten'
          ? 'This version passed the check.'
          : '')
  if (!text) return null
  return <p className={`turn-check ${unconfirmed.length ? 'turn-check-warn' : ''}`}>{text}</p>
}

function TutorPanel({ analysis, ai, onEnableAi }: Pick<Props, 'analysis' | 'ai' | 'onEnableAi'>) {
  const [turns, setTurns] = useState<Turn[]>([])
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const [question, setQuestion] = useState('')
  const tutor = useRef<Tutor | null>(null)

  const speak = async (prompt: string, question = '') => {
    setBusy(true)
    setTurns((t) => [...t, { who: 'tutor', text: '' }])
    try {
      tutor.current ??= await createTutor()
      const ctx = guardContext(analysis)
      // Numbers the student typed themselves are fair for the tutor to repeat.
      if (ctx) for (const m of question.matchAll(/\d+(?:\.\d+)?/g)) ctx.numbers.push(Number(m[0]))
      const reply = await guardedSay(tutor.current, prompt, ctx, (text) => setTurns((t) => [...t.slice(0, -1), { who: 'tutor', text }]))
      const hard = reply.attempts.flatMap((a) => a.flags).find((f) => WHY[f.kind])
      setTurns((t) => [...t.slice(0, -1), { who: 'tutor', text: reply.text, check: reply, reason: hard ? WHY[hard.kind] : '' }])
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
    void speak(followUpPrompt(analysis.steps, analysis.faultIndex!, q), q)
  }

  if (ai === 'unavailable' || failed)
    return (
      <section className="tutor tutor-off">
        <h3>Tutor</h3>
        <p className="muted">
          {failed ? 'The on-device model stopped responding, so the tutor is off for now. ' : ''}The explanation above comes from Faultline’s built-in rule library, which
          works in every browser. The conversational tutor uses the on-device model in desktop Chrome, so nothing you type is sent anywhere.
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
          <div key={i} className={`turn-wrap turn-wrap-${t.who}`}>
            {(t.text || !t.check) && <p className={`turn turn-${t.who}`}>{t.text || <span className="typing" aria-label="The tutor is thinking" />}</p>}
            {t.check && <CheckNote check={t.check} reason={t.reason ?? ''} />}
          </div>
        ))}
        {ai === 'checking' && <p className="muted">Looking for an on-device model…</p>}
      </div>
      <p className="tutor-caveat">
        The tutor’s words come from a small language model and can be muddled. The marked lines, the number check and the rule above are exact.
      </p>
      <form className="ask" onSubmit={ask}>
        <input value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Ask why, or say what you were thinking" aria-label="Ask the tutor a question" />
        <button className="btn" disabled={busy || !question.trim()}>
          Ask
        </button>
      </form>
    </section>
  )
}
