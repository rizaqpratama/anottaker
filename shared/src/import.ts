export function parseImports(name: string, contents: string) {
  const ext = name.toLowerCase().split('.').pop()
  if (ext === 'jsonl') return contents.split(/\r?\n/).filter(Boolean).map((line, index) => {
    const row = JSON.parse(line) as { text?: unknown }
    if (typeof row.text !== 'string' || !row.text.trim()) throw new Error(`Line ${index + 1} is missing a text field.`)
    return row.text.trim()
  })
  if (ext === 'csv') return contents.split(/\r?\n/).filter(Boolean).slice(1).map((line) => line.split(',')[0].replace(/^"|"$/g, '').trim()).filter(Boolean)
  return contents.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
}
