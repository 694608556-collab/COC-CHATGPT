import type { Coc7ImportPreview } from '../src/data/coc7-import'

/** Canonical complete draft proof for local tests. Only newly generated IDs
 * and creation timestamps are normalized; every imported field is retained. */
export function characterDraftProofText(preview: Coc7ImportPreview): string {
  const { id: _id, createdAt: _createdAt, updatedAt: _updatedAt, ...character } = preview.character
  const normalized = {
    ...preview,
    character: { ...character, skills: character.skills.map(({ id: _skillId, ...skill }) => skill) },
    issues: preview.issues.map(issue => ({ ...issue, key: issue.key.startsWith('skill:') ? 'skill:generated-id' : issue.key }))
  }
  function stable(value: any): any {
    if (Array.isArray(value)) return value.map(stable)
    if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]))
    return value
  }
  return JSON.stringify(stable(normalized))
}
