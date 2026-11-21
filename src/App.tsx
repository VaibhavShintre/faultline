import { useEffect, useMemo, useState } from 'react'
import { type AiStatus, aiStatus, createTutor, warmTutor } from './ai'
import { FaultCard } from './components/FaultCard'
import { Crack, StepEditor } from './components/StepEditor'
import { Tex } from './components/Tex'
import { type Analysis, analyze } from './engine/analyze'
import { type Mastery, level, loadMastery, observe, saveMastery } from './engine/bkt'
import { CATALOG, FAMILIES } from './engine/catalog'
import { lineToTex, parseLine } from './engine/line'
import type { MisconceptionId } from './engine/malrules'
import { type Problem, hasTargetedPractice, isFinished, makeProblem } from './engine/practice'

type Tab = 'check' | 'practice' | 'map'

const EXAMPLES: { title: string; lines: string[] }[] = [
  { title: 'Brackets', lines: ['3(x - 2) + 4 = 19', '3x - 2 + 4 = 19', '3x + 2 = 19', '3x = 17', 'x = 17/3'] },
  { title: 'Minus a bracket', lines: ['12 - (x - 4) = 9', '12 - x - 4 = 9', '8 - x = 9', 'x = -1'] },
  { title: 'Squaring', lines: ['(x + 5)^2 - x^2', 'x^2 + 25 - x^2', '25'] },
  { title: 'Quadratic', lines: ['x^2 - 9 = 40', 'x^2 = 49', 'x = 7'] },
  { title: 'Fractions', lines: ['x/3 + 2 = 6', 'x + 2 = 18', 'x = 16'] },
  { title: 'Factoring', lines: ['x^2 - 5x + 6 = 0', '(x - 2)(x - 3) = 0', 'x = -2 or x = -3'] },
  { title: 'Two mistakes', lines: ['5(x + 2) - 3 = 2x + 19', '5x + 2 - 3 = 2x + 19', '5x - 1 = 2x + 19', '7x - 1 = 19', '7x = 20', 'x = 20/7'] },
  { title: 'All correct', lines: ['2(x + 5) = 3x - 4', '2x + 10 = 3x - 4', '10 = x - 4', 'x = 14'] },
]

export default function App() {
  const [tab, setTab] = useState<Tab>('check')
  const [ai, setAi] = useState<AiStatus>('checking')
  const [mastery, setMastery] = useState<Mastery>(loadMastery)
  const [practiceSkill, setPracticeSkill] = useState<MisconceptionId>('distribute-partial')

  useEffect(() => {
    void aiStatus().then((status) => {
      setAi(status)
      if (status === 'ready') warmTutor()
    })
  }, [])
  useEffect(() => saveMastery(mastery), [mastery])

  const record = (skill: MisconceptionId, correct: boolean) => setMastery((m) => ({ ...m, [skill]: observe(m[skill], correct) }))

  const enableAi = async () => {
    setAi('downloading')
    try {
      const t = await createTutor()
      t.destroy()
      setAi('ready')
    } catch {
      setAi('unavailable')
    }
  }

  const practise = (skill: MisconceptionId) => {
    setPracticeSkill(skill)
    setTab('practice')
    window.scrollTo({ top: 0 })
  }

  const seen = Object.keys(mastery).length

  return (
    <div className="app">
      <header className="top">
        <a className="brand" href="./" aria-label="Faultline home">
          <svg viewBox="0 0 40 40" width="34" height="34" aria-hidden="true">
            <rect width="40" height="40" rx="10" fill="var(--ink)" />
            <path d="M22 6 14 18l8 4-6 12" fill="none" stroke="var(--fault)" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span>
            <strong>Faultline</strong>
            <em>Find the line where it broke, and why.</em>
          </span>
        </a>
        <nav className="tabs" aria-label="Sections">
          <button className={tab === 'check' ? 'on' : ''} onClick={() => setTab('check')}>
            Check my work
          </button>
          <button className={tab === 'practice' ? 'on' : ''} onClick={() => setTab('practice')}>
            Practise
          </button>
          <button className={tab === 'map' ? 'on' : ''} onClick={() => setTab('map')}>
            My map{seen > 0 && <span className="count">{seen}</span>}
          </button>
        </nav>
        <span className={`pill ${ai === 'ready' ? 'pill-ai' : ''}`} title="The tutor's language model runs inside your browser. Your work is never uploaded.">
          {ai === 'ready' ? 'On-device AI ready' : ai === 'checking' ? 'Checking for on-device AI' : ai === 'unavailable' ? 'Rule library only' : 'On-device AI available'}
        </span>
      </header>

      {tab === 'check' && <CheckView ai={ai} onEnableAi={enableAi} onFault={(id) => record(id, false)} onPractice={practise} />}
      {tab === 'practice' && <PracticeView key={practiceSkill} skill={practiceSkill} setSkill={setPracticeSkill} mastery={mastery} record={record} ai={ai} onEnableAi={enableAi} />}
      {tab === 'map' && <MapView mastery={mastery} onPractice={practise} onReset={() => setMastery({})} />}

      <footer className="foot">
        <p>
          Marking is done by exact symbolic arithmetic, so a correct line is never marked wrong. The language model only words the explanation, and it runs on
          your device.
        </p>
      </footer>
    </div>
  )
}

/* -------------------------------- Check view -------------------------------- */

function CheckView({ ai, onEnableAi, onFault, onPractice }: { ai: AiStatus; onEnableAi: () => void; onFault: (id: MisconceptionId) => void; onPractice: (id: MisconceptionId) => void }) {
  const [lines, setLines] = useState<string[]>(['', ''])
  const [analysis, setAnalysis] = useState<Analysis | null>(null)
  const [recorded, setRecorded] = useState('')

  const edit = (next: string[]) => {
    setLines(next)
    setAnalysis(null)
  }

  const check = (source = lines) => {
    const a = analyze(source)
    setAnalysis(a)
    if (a.faultIndex !== null) {
      const key = `${a.steps[0].raw}|${a.faults.map((i) => a.steps[i].raw).join('|')}`
      if (key !== recorded) {
        // Every separate mistake counts against its own misconception, not just the first one.
        a.faults.forEach((i) => onFault(a.steps[i].diagnosis!.id))
        setRecorded(key)
      }
    }
  }

  const load = (example: string[]) => {
    setLines(example)
    check(example)
  }

  const readable = analysis?.steps.filter((s) => s.line).length ?? 0
  const unreadable = !!analysis?.steps.some((s) => s.status === 'unreadable')

  return (
    <main className="grid">
      <section className="card work">
        <header className="card-head">
          <h1>Your working</h1>
          <p className="muted">One step per line, exactly as you wrote it on paper. Press Enter for a new line.</p>
        </header>
        <StepEditor lines={lines} onChange={edit} analysis={analysis} onCheck={() => check()} />
        <div className="card-actions">
          <button className="btn btn-primary" onClick={() => check()} disabled={lines.filter((l) => l.trim()).length < 2}>
            Find the fault line
          </button>
          <button className="btn btn-quiet" onClick={() => edit(['', ''])}>
            Clear
          </button>
          <span className="kbd-hint">⌘/Ctrl + Enter</span>
        </div>
        <div className="examples">
          <span className="muted">Try some real student working:</span>
          {EXAMPLES.map((ex) => (
            <button key={ex.title} className="chip" onClick={() => load(ex.lines)}>
              {ex.title}
            </button>
          ))}
        </div>
      </section>

      <section className="result">
        {!analysis && <HowItWorks />}
        {analysis && analysis.faults.map((i) => <FaultCard key={i} analysis={analysis} index={i} ai={ai} onEnableAi={onEnableAi} onPractice={onPractice} />)}
        {analysis && analysis.faultIndex === null && analysis.clean && unreadable && <UnreadableCard />}
        {analysis && analysis.faultIndex === null && analysis.clean && !unreadable && (
          <article className="card clean-card">
            <span className="eyebrow eyebrow-ok">✓ No fault lines</span>
            <h2>Every line follows from the one before.</h2>
            <p>All {readable} lines describe exactly the same solutions, so the method holds from start to finish.</p>
          </article>
        )}
        {analysis && analysis.faultIndex === null && !analysis.clean && (
          <article className="card">
            <span className="eyebrow">Not enough to check</span>
            <h2>Add at least two readable lines.</h2>
            <p>Faultline compares each line with the one above it. Lines marked “?” could not be read: check for a missing bracket or a stray symbol.</p>
          </article>
        )}
      </section>
    </main>
  )
}

function UnreadableCard() {
  return (
    <article className="card">
      <span className="eyebrow">One line could not be read</span>
      <h2>Fix the line marked “?” and check again.</h2>
      <p>The lines Faultline could read all follow from each other. Look for a missing bracket, two equals signs on one line, or a stray symbol.</p>
    </article>
  )
}

function HowItWorks() {
  return (
    <article className="card how">
      <span className="eyebrow">How it works</span>
      <h2>A wrong answer tells you nothing. The wrong line tells you everything.</h2>
      <ol className="how-steps">
        <li>
          <p>
          <b>Exact checking.</b> Each line is compared with the one above using symbolic algebra. The first line that changes the meaning is the fault line.
          </p>
        </li>
        <li>
          <p>
          <b>Diagnosis.</b> Known wrong rules from tutoring research are replayed on your previous line. The one that reproduces your line is the misconception.
          </p>
        </li>
        <li>
          <p>
          <b>Repair.</b> An on-device tutor talks it through, you practise that exact mistake, and your map tracks whether it is really gone.
          </p>
        </li>
      </ol>
    </article>
  )
}

/* ------------------------------- Practice view ------------------------------ */

function PracticeView({
  skill,
  setSkill,
  mastery,
  record,
  ai,
  onEnableAi,
}: {
  skill: MisconceptionId
  setSkill: (s: MisconceptionId) => void
  mastery: Mastery
  record: (s: MisconceptionId, correct: boolean) => void
  ai: AiStatus
  onEnableAi: () => void
}) {
  const [problem, setProblem] = useState<Problem>(() => makeProblem(skill))
  const [lines, setLines] = useState<string[]>(() => [problem.start, ''])
  const [analysis, setAnalysis] = useState<Analysis | null>(null)
  const [streak, setStreak] = useState(0)
  const [scored, setScored] = useState(false)

  const next = () => {
    const p = makeProblem(skill)
    setProblem(p)
    setLines([p.start, ''])
    setAnalysis(null)
    setScored(false)
  }

  const last = analysis?.steps.filter((s) => s.line).pop()
  const unreadable = !!analysis?.steps.some((st) => st.status === 'unreadable')
  const solved = !!analysis && analysis.clean && !unreadable && !!last?.line && isFinished(problem.task, last.line)

  const check = () => {
    const a = analyze(lines)
    setAnalysis(a)
    if (scored) return
    if (a.faultIndex !== null) {
      record(a.steps[a.faultIndex].diagnosis!.id, false)
      if (a.steps[a.faultIndex].diagnosis!.id !== skill) record(skill, false)
      setStreak(0)
      setScored(true)
    } else {
      const end = a.steps.filter((s) => s.line).pop()
      if (a.clean && !a.steps.some((st) => st.status === 'unreadable') && end?.line && isFinished(problem.task, end.line)) {
        record(skill, true)
        setStreak((s) => s + 1)
        setScored(true)
      }
    }
  }

  const skills = useMemo(
    () => (Object.keys(CATALOG) as MisconceptionId[]).filter(hasTargetedPractice).sort((a, b) => (mastery[a]?.p ?? 0.5) - (mastery[b]?.p ?? 0.5)),
    // Order is fixed when the view opens so chips do not jump while practising.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )
  const p = mastery[skill]?.p

  return (
    <main className="grid">
      <section className="card work">
        <header className="card-head">
          <span className="eyebrow">{problem.task === 'solve' ? 'Solve for x' : 'Simplify fully'}</span>
          <div className="problem">
            <Tex tex={lineToTex(parseLine(problem.start))} block />
          </div>
          <p className="muted">Show every step. This problem is built to tempt the “{CATALOG[skill].name.toLowerCase()}” mistake.</p>
        </header>
        <StepEditor
          lines={lines}
          onChange={(l) => {
            setLines(l)
            setAnalysis(null)
          }}
          analysis={analysis}
          lockFirst
          onCheck={check}
        />
        <div className="card-actions">
          <button className="btn btn-primary" onClick={check} disabled={lines.filter((l) => l.trim()).length < 2}>
            Check my steps
          </button>
          <button className="btn btn-quiet" onClick={next}>
            {solved ? 'Next problem' : 'Skip'}
          </button>
          {streak > 1 && <span className="streak">{streak} in a row</span>}
        </div>
        <div className="examples">
          <span className="muted">Practise a different mistake (weakest first):</span>
          {skills.map((s) => (
            <button key={s} className={`chip ${s === skill ? 'chip-on' : ''}`} onClick={() => setSkill(s)}>
              {CATALOG[s].name}
            </button>
          ))}
        </div>
      </section>

      <section className="result">
        {analysis && analysis.faults.map((i) => <FaultCard key={i} analysis={analysis} index={i} ai={ai} onEnableAi={onEnableAi} />)}
        {solved && (
          <article className="card clean-card">
            <span className="eyebrow eyebrow-ok">✓ Solved without the mistake</span>
            <h2>That one held.</h2>
            <p>
              Every line follows and the answer is fully worked out. Estimated mastery of “{CATALOG[skill].name.toLowerCase()}” is now{' '}
              <strong>{Math.round((mastery[skill]?.p ?? 0.5) * 100)}%</strong>.
            </p>
            <div className="card-actions">
              <button className="btn btn-primary" onClick={next}>
                Next problem
              </button>
            </div>
          </article>
        )}
        {analysis && analysis.faultIndex === null && unreadable && <UnreadableCard />}
        {analysis && analysis.faultIndex === null && !solved && !unreadable && (
          <article className="card">
            <span className="eyebrow eyebrow-ok">✓ Correct so far</span>
            <h2>Keep going.</h2>
            <p>{problem.task === 'solve' ? 'Every line is right, but x is not on its own yet.' : 'Every line is right, but it can still be simplified.'}</p>
          </article>
        )}
        {!analysis && (
          <article className="card how">
            <span className="eyebrow">Targeted practice</span>
            <h2>{CATALOG[skill].name}</h2>
            <p>{CATALOG[skill].principle}</p>
            <Meter p={p} />
            <p className="muted">
              Mastery is estimated with Bayesian Knowledge Tracing: a slip pulls it down, each clean solution pulls it up, and three or four in a row usually
              clears it.
            </p>
          </article>
        )}
      </section>
    </main>
  )
}

/* --------------------------------- Map view --------------------------------- */

function Meter({ p }: { p: number | undefined }) {
  const lv = p === undefined ? 'unseen' : level(p)
  return (
    <div className={`meter meter-${lv}`} role="img" aria-label={p === undefined ? 'Not seen yet' : `Mastery ${Math.round(p * 100)} percent, ${lv}`}>
      <div className="meter-track">
        <div className="meter-fill" style={{ width: `${Math.round((p ?? 0) * 100)}%` }} />
      </div>
      <span className="meter-label">{p === undefined ? 'not seen yet' : `${Math.round(p * 100)}% · ${lv}`}</span>
    </div>
  )
}

function MapView({ mastery, onPractice, onReset }: { mastery: Mastery; onPractice: (s: MisconceptionId) => void; onReset: () => void }) {
  const ids = (Object.keys(CATALOG) as MisconceptionId[]).filter((id) => id !== 'unknown')
  const seen = ids.filter((id) => mastery[id])
  const weakest = [...seen].sort((a, b) => mastery[a]!.p - mastery[b]!.p).filter((id) => mastery[id]!.p < 0.9).slice(0, 3)
  const [copied, setCopied] = useState(false)
  // Mistakes you have made come first, weakest at the top; the rest follow grouped by topic.
  const ordered = [
    ...[...seen].sort((a, b) => mastery[a]!.p - mastery[b]!.p),
    ...ids.filter((id) => !mastery[id]).sort((a, b) => FAMILIES.indexOf(CATALOG[a].family) - FAMILIES.indexOf(CATALOG[b].family)),
  ]

  const summary = () =>
    [
      'Faultline misconception report',
      ...seen
        .sort((a, b) => mastery[a]!.p - mastery[b]!.p)
        .map((id) => `- ${CATALOG[id].name}: ${Math.round(mastery[id]!.p * 100)}% mastery (${mastery[id]!.errors} slips, ${mastery[id]!.fixes} clean solutions)`),
    ].join('\n')

  return (
    <main className="map">
      <section className="card map-head">
        <span className="eyebrow">
          <Crack /> My misconception map
        </span>
        {seen.length === 0 ? (
          <>
            <h1>Nothing mapped yet.</h1>
            <p className="muted">Check some working or try a practice problem. Every mistake Faultline diagnoses is tracked here until it stops happening.</p>
          </>
        ) : weakest.length === 0 ? (
          <h1>Every fault line you have hit is now solid.</h1>
        ) : (
          <>
            <h1>
              Your active fault {weakest.length === 1 ? 'line is' : 'lines are'} {weakest.map((id) => CATALOG[id].name.toLowerCase()).join(', ')}.
            </h1>
            <p className="muted">Each bar is the estimated chance that the misconception is really gone, updated after every checked solution.</p>
          </>
        )}
        {seen.length > 0 && (
          <div className="card-actions">
            <button
              className="btn"
              onClick={() => {
                void navigator.clipboard?.writeText(summary()).then(() => setCopied(true))
              }}
            >
              {copied ? 'Copied' : 'Copy report for my teacher'}
            </button>
            <button className="btn btn-quiet" onClick={onReset}>
              Reset map
            </button>
          </div>
        )}
      </section>

      <section className="tiles">
        {ordered.map((id) => {
          const s = mastery[id]
          return (
            <article key={id} className={`tile ${s ? '' : 'tile-unseen'}`}>
              <span className="tile-family">{CATALOG[id].family}</span>
              <h3>{CATALOG[id].name}</h3>
              <p className="muted">{CATALOG[id].belief}</p>
              <Meter p={s?.p} />
              <div className="tile-foot">
                <span className="muted">{s ? `${s.errors} slip${s.errors === 1 ? '' : 's'} · ${s.fixes} clean` : ''}</span>
                <button className="link" onClick={() => onPractice(id)}>
                  Practise
                </button>
              </div>
            </article>
          )
        })}
      </section>
    </main>
  )
}
