import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const directory = process.argv[2]
if (!directory)
  throw new Error('Usage: node scripts/summarize-ios-name-trace.mjs <public-CI-evidence-directory>')
const events = (await readFile(resolve(directory, 'ios-name-events.jsonl'), 'utf8'))
  .split('\n')
  .filter(Boolean)
  .map((line) => JSON.parse(line))
const log = await readFile(resolve(directory, 'picker-ui.log'), 'utf8')
if (!events.some((event) => event.kind === 'trace-ready'))
  throw new Error('No installed event trace; cannot infer input behavior')
const suspicious = (value) => typeof value === 'string' && /^Public (Alpha|Beta)\s+$/.test(value)
const affected = events.filter(
  (event) => event.fields?.some((field) => suspicious(field.value)) || suspicious(event.option?.value)
)
const context = new Set()
const candidateClicks = events.filter(
  (event) => event.kind === 'dom' && event.event === 'click' && event.phase === 'capture' && event.option
).length
// Follow the exact submitted character id into a later startup overview.
// Repeated cases use the same public name, so a first matching UI label alone
// cannot prove that the newly saved character survived restart.
const savedRoundTrips = events.flatMap((event, index) =>
  event.kind === 'bridge-request' && event.method === 'commitEntity'
    ? (event.names?.characters || []).map((character) => {
        const later = events
          .slice(index + 1)
          .find(
            (entry) =>
              (entry.kind === 'native-overview' ||
                (entry.kind === 'bridge-result' && entry.method === 'getOverview')) &&
              entry.saved?.characters?.some((saved) => saved.id === character.id)
          )
        const stored = later?.saved.characters.find((saved) => saved.id === character.id)
        return {
          id: character.id,
          requested: character.name,
          stored: stored?.name ?? null,
          exact: stored ? stored.name?.value === character.name.value : null,
          evidence: stored
            ? `${later.kind === 'native-overview' ? 'native' : 'bridge'} startup overview captured`
            : 'startup overview not captured; not evidence of data loss'
        }
      })
    : []
)
for (const event of affected) {
  const index = events.indexOf(event)
  for (let at = Math.max(0, index - 4); at <= Math.min(events.length - 1, index + 4); at++) context.add(at)
}
const result = {
  scope: 'Public CI fixture only; exact values retained, no normalization or assertion changes',
  events: events.length,
  launches: events.filter((event) => event.kind === 'launch').length,
  tracedDocuments: events.filter((event) => event.kind === 'trace-ready').length,
  keyboardNotifications: events.filter((event) => event.kind === 'keyboard').length,
  candidateClicks,
  savedRoundTrips,
  inputEvents: events.filter(
    (event) => event.kind === 'dom' && ['beforeinput', 'input', 'compositionend'].includes(event.event)
  ),
  bridgeNames: events.filter((event) => event.kind.startsWith('bridge')),
  uiResults: log.split('\n').filter((line) => /Test Case.*testPublicName.*(passed|failed)/.test(line)),
  trailingWhitespaceObservations: affected.length,
  trailingWhitespaceContext: [...context].sort((a, b) => a - b).map((index) => events[index]),
  conclusion: !candidateClicks
    ? 'No candidate clicks captured; this run cannot assess the original candidate issue'
    : affected.length
      ? 'Trailing whitespace observed; inspect event context before assigning cause'
      : 'No trailing whitespace captured in this sample; this is not proof of a fix'
}
await writeFile(resolve(directory, 'ios-name-trace-summary.json'), JSON.stringify(result, null, 2))
console.log(
  JSON.stringify(
    {
      events: result.events,
      launches: result.launches,
      tracedDocuments: result.tracedDocuments,
      candidateClicks: result.candidateClicks,
      savedRoundTrips: result.savedRoundTrips,
      uiResults: result.uiResults,
      trailingWhitespaceObservations: result.trailingWhitespaceObservations,
      conclusion: result.conclusion
    },
    null,
    2
  )
)
