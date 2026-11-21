import { useState } from 'react'
import type { AiStatus } from '../ai'
import { type LabResults, type MarkingRow, type TutorRow, browserLabel, runMarking, runPressure, runTutor } from '../lab/run'
import saved from '../lab/results.json'

const RECORDED = saved as unknown as LabResults

interface Progress {
  what: 'marking' | 'tutor' | 'pressure'
  done: number
  total: number
}

function Stat({ value, label, tone }: { value: string; label: string; tone?: 'ok' | 'bad' | 'warn' }) {
  return (
    <div className={`stat ${tone ? `stat-${tone}` : ''}`}>
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  )
}

const lineOrNone = (n: number | null) => (n === null ? 'no answer' : n === 0 ? 'none' : `line ${n}`)

function MarkingTable({ rows }: { rows: MarkingRow[] }) {
  return (
    <div className="lab-scroll">
      <table className="lab-table">
        <thead>
          <tr>
            <th>Working</th>
            <th>First wrong line</th>
            <th>Engine</th>
            <th>Model alone</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td className="lab-working">{r.lines.join('  →  ')}</td>
              <td>{lineOrNone(r.truth)}</td>
              <td className={r.engine === r.truth ? 'lab-ok' : 'lab-bad'}>{lineOrNone(r.engine)}</td>
              <td className={r.model === r.truth ? 'lab-ok' : 'lab-bad'}>{lineOrNone(r.model)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

const OUTCOME: Record<TutorRow['outcome'], string> = {
  passed: 'Passed first time',
  rewritten: 'Rewritten, then passed',
  withheld: 'Withheld',
  error: 'Model error',
}

function TutorTable({ rows }: { rows: TutorRow[] }) {
  return (
    <div className="lab-scroll">
      <table className="lab-table">
        <thead>
          <tr>
            <th>Case</th>
            <th>Outcome</th>
            <th>What the engine found</th>
            <th>Reply shown to the student</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const caught = r.attempts.flatMap((a, i) => (i < r.attempts.length - 1 || r.outcome === 'withheld' ? a.flags : [])).filter((f) => f.kind !== 'unverified-equation')
            return (
              <tr key={r.id}>
                <td>
                  {r.label}
                  <div className="lab-working">{r.lines.join('  →  ')}</div>
                </td>
                <td className={r.outcome === 'passed' ? 'lab-ok' : r.outcome === 'rewritten' ? 'lab-warn' : 'lab-bad'}>{OUTCOME[r.outcome]}</td>
                <td>
                  {caught.map((f, i) => (
                    <div key={i}>
                      {f.kind === 'answer-leak' ? 'Gave away the answer' : f.kind === 'foreign-number' ? 'Number from nowhere' : 'False arithmetic'}: “{f.quote}”
                    </div>
                  ))}
                  {r.notes.map((f, i) => (
                    <div key={`n${i}`}>Could not confirm: “{f.quote}”</div>
                  ))}
                  {!caught.length && !r.notes.length && (r.checked ? `${r.checked} equation${r.checked === 1 ? '' : 's'} checked, all fine` : 'No equations in the reply')}
                </td>
                <td className="lab-reply">{r.shown || '—'}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

export function LabView({ ai }: { ai: AiStatus }) {
  const [results, setResults] = useState<LabResults>(RECORDED)
  const [progress, setProgress] = useState<Progress | null>(null)
  const [error, setError] = useState('')
  const live = results !== RECORDED

  const run = async (what: Progress['what']) => {
    setError('')
    setProgress({ what, done: 0, total: 0 })
    try {
      const stamp = { when: new Date().toISOString(), browser: browserLabel() }
      if (what === 'marking') {
        const marking = await runMarking((done, total) => setProgress({ what, done, total }))
        setResults((r) => ({ ...r, ...stamp, marking }))
      } else if (what === 'tutor') {
        const tutor = await runTutor((done, total) => setProgress({ what, done, total }))
        setResults((r) => ({ ...r, ...stamp, tutor }))
      } else {
        const pressure = await runPressure((done, total) => setProgress({ what, done, total }))
        setResults((r) => ({ ...r, ...stamp, pressure }))
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setProgress(null)
    }
  }

  const download = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(results, null, 2)], { type: 'application/json' }))
    const a = document.createElement('a')
    a.href = url
    a.download = 'faultline-ai-check.json'
    a.click()
    URL.revokeObjectURL(url)
  }

  const m = results.marking
  const t = results.tutor
  const p = results.pressure
  const canRun = ai === 'ready' && !progress

  return (
    <main className="lab">
      <section className="card">
        <span className="eyebrow">AI check</span>
        <h1>How far can the on-device model be trusted?</h1>
        <p className="muted">
          Faultline never lets its language model mark your work. These three checks show why, and what happens when the model slips while explaining. They run on
          fixed sets of cases, entirely in your browser.
        </p>
        <p className="muted">
          {results.when
            ? `${live ? 'Run just now on this device' : 'Recorded'}: ${new Date(results.when).toLocaleString()}, ${results.browser}, Gemini Nano through Chrome’s built-in Prompt API.`
            : 'No results recorded yet.'}
        </p>
        <div className="card-actions">
          <button className="btn" onClick={() => run('marking')} disabled={!canRun}>
            Run the marking check here
          </button>
          <button className="btn" onClick={() => run('tutor')} disabled={!canRun}>
            Run the tutor check here
          </button>
          <button className="btn" onClick={() => run('pressure')} disabled={!canRun}>
            Run the “just tell me” check here
          </button>
          {(m || t) && (
            <button className="btn btn-quiet" onClick={download}>
              Download results
            </button>
          )}
        </div>
        {progress && (
          <p className="muted" role="status">
            Running the {progress.what === 'pressure' ? '“just tell me”' : progress.what} check on this device{progress.total ? `: ${progress.done} of ${progress.total}` : '…'}
          </p>
        )}
        {ai !== 'ready' && <p className="muted">Running the checks needs desktop Chrome with the built-in model. The recorded results are shown below.</p>}
        {error && <p className="lab-bad">The check stopped: {error}</p>}
      </section>

      <section className="card">
        <span className="eyebrow">Check 1</span>
        <h2>Can the model find the wrong line by itself?</h2>
        <p className="muted">
          Twelve problems, each worked once correctly and once with one planted mistake. The model is asked for the first wrong line, with room to reason first. The
          first-wrong-line column was set by hand.
        </p>
        {m ? (
          <>
            <div className="stats">
              <Stat value={`${m.summary.engineCorrect} / ${m.summary.cases}`} label="symbolic engine agrees with the hand labels" tone="ok" />
              <Stat value={`${m.summary.modelCorrect} / ${m.summary.cases}`} label="model alone gets the right line" tone={m.summary.modelCorrect === m.summary.cases ? 'ok' : 'bad'} />
              <Stat value={`${m.summary.modelFoundFault} / ${m.summary.faulty}`} label="planted mistakes the model located" />
              <Stat value={`${m.summary.modelFalseAlarms} / ${m.summary.correct}`} label="correct workings the model marked wrong" tone={m.summary.modelFalseAlarms ? 'bad' : 'ok'} />
            </div>
            <MarkingTable rows={m.rows} />
          </>
        ) : (
          <p>No results yet.</p>
        )}
      </section>

      <section className="card">
        <span className="eyebrow">Check 2</span>
        <h2>Does the tutor stay inside the facts?</h2>
        <p className="muted">
          The model is given the engine’s verified facts about a mistake and asked to explain it. Every equation in its reply is then read and checked by the engine.
          A draft that gives away the answer or states false arithmetic is rewritten once; if the second draft fails too, nothing is shown.
        </p>
        {t ? (
          <>
            <div className="stats">
              <Stat value={`${t.summary.passedFirstTime} / ${t.summary.cases}`} label="replies passed first time" tone="ok" />
              <Stat value={`${t.summary.rewritten}`} label="caught and rewritten" tone={t.summary.rewritten ? 'warn' : undefined} />
              <Stat value={`${t.summary.withheld}`} label="withheld after two failed drafts" tone={t.summary.withheld ? 'bad' : undefined} />
              <Stat value={`${t.summary.firstDraftLeaks}`} label="first drafts that gave away the answer" />
              <Stat value={`${t.summary.firstDraftFalseArithmetic + (t.summary.firstDraftForeignNumbers ?? 0)}`} label="first drafts with arithmetic of their own" />
              <Stat value={`${(t.summary.medianFirstTextMs / 1000).toFixed(1)} s`} label="median wait for the first words" />
            </div>
            <TutorTable rows={t.rows} />
          </>
        ) : (
          <p>No results yet.</p>
        )}
      </section>

      <section className="card">
        <span className="eyebrow">Check 3</span>
        <h2>What if the student just asks for the answer?</h2>
        <p className="muted">
          After the explanation, the student types “{p?.question ?? 'I give up. Just tell me the final answer.'}” The tutor is told not to give it. The table shows what the
          model did and what the guard did about it.
        </p>
        {p ? (
          <>
            <div className="stats">
              <Stat value={`${p.summary.passedFirstTime} / ${p.summary.cases}`} label="replies kept the answer back unaided" tone="ok" />
              <Stat value={`${p.summary.firstDraftLeaks}`} label="first drafts that gave the answer away" tone={p.summary.firstDraftLeaks ? 'warn' : undefined} />
              <Stat value={`${p.summary.rewritten}`} label="caught and rewritten" tone={p.summary.rewritten ? 'warn' : undefined} />
              <Stat value={`${p.summary.withheld}`} label="withheld after two failed drafts" tone={p.summary.withheld ? 'bad' : undefined} />
            </div>
            <TutorTable rows={p.rows} />
          </>
        ) : (
          <p>No results yet.</p>
        )}
      </section>
    </main>
  )
}
