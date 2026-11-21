import { useEffect, useMemo, useRef } from 'react'
import type { Analysis, StepStatus } from '../engine/analyze'
import { lineToTex, parseLine } from '../engine/line'
import { Tex } from './Tex'

interface Props {
  lines: string[]
  onChange: (lines: string[]) => void
  /** Verdict from the last check, or null while the student is still editing. */
  analysis: Analysis | null
  /** First line is the given problem and cannot be edited (practice mode). */
  lockFirst?: boolean
  onCheck: () => void
}

const LABEL: Record<StepStatus, string> = {
  start: 'Starting line',
  ok: 'Follows from the line above',
  fault: 'This is the fault line',
  carried: 'Follows from the line above, which was already wrong',
  'second-fault': 'A second, separate mistake',
  recovered: 'Back on track: agrees with the correct working again',
  unreadable: 'Could not read this line',
  blank: '',
}

function preview(raw: string): { tex: string } | { error: true } | null {
  if (!raw.trim()) return null
  try {
    return { tex: lineToTex(parseLine(raw)) }
  } catch {
    return { error: true }
  }
}

export function StepEditor({ lines, onChange, analysis, lockFirst, onCheck }: Props) {
  const inputs = useRef<(HTMLInputElement | null)[]>([])
  const previews = useMemo(() => lines.map(preview), [lines])
  // Focus moves after React has rendered the new row, not before.
  const pending = useRef<number | null>(null)
  const focus = (i: number) => {
    pending.current = i
  }
  useEffect(() => {
    if (pending.current === null) return
    inputs.current[pending.current]?.focus()
    pending.current = null
  }, [lines.length])

  const set = (i: number, value: string) => onChange(lines.map((l, j) => (i === j ? value : l)))

  const onKey = (i: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      if (e.metaKey || e.ctrlKey) return onCheck()
      onChange([...lines.slice(0, i + 1), '', ...lines.slice(i + 1)])
      focus(i + 1)
    } else if (e.key === 'Backspace' && lines[i] === '' && lines.length > 1 && !(lockFirst && i === 0)) {
      e.preventDefault()
      onChange(lines.filter((_, j) => j !== i))
      focus(Math.max(0, i - 1))
    } else if (e.key === 'ArrowDown' && i < lines.length - 1) {
      inputs.current[i + 1]?.focus()
    } else if (e.key === 'ArrowUp' && i > 0) {
      inputs.current[i - 1]?.focus()
    }
  }

  return (
    <ol className="steps">
      {lines.map((raw, i) => {
        const status: StepStatus | 'editing' = analysis?.steps[i]?.status ?? 'editing'
        const p = previews[i]
        const locked = lockFirst && i === 0
        return (
          <li key={i} className={`step step-${status}`}>
            <span className="step-mark" title={status === 'editing' ? '' : LABEL[status]} aria-label={status === 'editing' ? `Line ${i + 1}` : LABEL[status]}>
              {status === 'ok' || status === 'recovered' ? '✓' : status === 'fault' || status === 'second-fault' ? <Crack /> : status === 'carried' ? '→' : status === 'unreadable' ? '?' : i + 1}
            </span>
            <div className="step-body">
              <input
                ref={(el) => {
                  inputs.current[i] = el
                }}
                className="step-input"
                value={raw}
                readOnly={locked}
                spellCheck={false}
                autoComplete="off"
                autoCapitalize="off"
                placeholder={i === 0 ? 'Start with the problem, for example 3(x - 2) + 4 = 19' : 'Next line of your working'}
                aria-label={`Line ${i + 1}`}
                onChange={(e) => set(i, e.target.value)}
                onKeyDown={(e) => onKey(i, e)}
              />
              <div className="step-preview" aria-hidden="true">
                {p && 'tex' in p ? <Tex tex={p.tex} /> : p ? <span className="step-hint">keep typing…</span> : null}
              </div>
              {analysis?.steps[i]?.status === 'unreadable' && <p className="step-problem">{analysis.steps[i].problem}</p>}
              {status === 'carried' && <p className="step-note">Follows from the line above, so it carries the earlier mistake forward.</p>}
              {status === 'second-fault' && <p className="step-note step-note-fault">A second, separate mistake: this does not follow from the line above either.</p>}
              {status === 'recovered' && <p className="step-note step-note-ok">Back on track: this agrees with the correct working again.</p>}
            </div>
            {!locked && lines.length > 1 && (
              <button className="step-remove" aria-label={`Remove line ${i + 1}`} onClick={() => onChange(lines.filter((_, j) => j !== i))}>
                ×
              </button>
            )}
          </li>
        )
      })}
    </ol>
  )
}

export function Crack() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path d="M9 1 5.5 6.5 9 8.5 6 15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
