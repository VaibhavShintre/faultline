import katex from 'katex'
import { useMemo } from 'react'

export function Tex({ tex, block = false }: { tex: string; block?: boolean }) {
  const html = useMemo(() => katex.renderToString(tex, { throwOnError: false, displayMode: block, strict: false }), [tex, block])
  return <span className={block ? 'tex tex-block' : 'tex'} dangerouslySetInnerHTML={{ __html: html }} />
}

/** Text with $inline maths$ segments. */
export function Rich({ text }: { text: string }) {
  const parts = text.split(/\$([^$]+)\$/g)
  return <>{parts.map((p, i) => (i % 2 ? <Tex key={i} tex={p} /> : <span key={i}>{p}</span>))}</>
}
