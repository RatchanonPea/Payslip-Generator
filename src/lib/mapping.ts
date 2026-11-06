import { FIELDS } from './fields'
import type { Mapping } from './types'

const norm = (s: string) => s.toLowerCase().replace(/[\s_\-./()]/g, '')

export function autoMap(headers: string[]): Mapping {
  const m: Mapping = {}
  const used = new Set<string>()
  for (const f of FIELDS) {
    const wanted = f.aliases.map(norm)
    const hit = headers.find((h) => !used.has(h) && wanted.includes(norm(h)))
    if (hit) { m[f.key] = hit; used.add(hit) }
  }
  return m
}
