import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'

/**
 * Guard against a bug class that bit us repeatedly: app code reads/writes a
 * Firestore collection that the deployed `firestore.rules` do not cover, so the
 * operation is DENIED for every role (a page loads but shows no data, a form
 * can't submit, etc.). It's invisible to normal review because the code and the
 * rules are each individually fine — the gap only exists between them.
 *
 * This test mechanically diffs the collection names referenced in code against
 * the `match` blocks in firestore.rules and fails if any is unruled.
 *
 * Scope: top-level collection names (the first path segment of a
 * collection()/collectionGroup()/doc() call). That's exactly the class we hit
 * (settings, candidates, jobDescriptions, nonWorkingInventory, deletedItems).
 * Dynamic collection names (a variable instead of a string literal) can't be
 * resolved statically and are skipped.
 */

function walk(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) {
      if (name === 'node_modules' || name === '__tests__') continue
      walk(p, acc)
    } else if (/\.(ts|tsx)$/.test(name)) {
      acc.push(p)
    }
  }
  return acc
}

describe('Firestore rules coverage', () => {
  it('every collection referenced in code has a matching rule in firestore.rules', () => {
    const root = process.cwd()
    const rules = readFileSync(join(root, 'firestore.rules'), 'utf8')

    // Names that have a `match /NAME/{...}` block (top-level or nested).
    const ruled = new Set<string>()
    for (const m of rules.matchAll(/match\s+\/([A-Za-z0-9_]+)\//g)) ruled.add(m[1])
    ruled.delete('databases') // the wrapper match, not a real collection

    // First path segment of every collection()/collectionGroup()/doc() call
    // that uses a string-literal collection name.
    const re = /(?:collection|collectionGroup|doc)\(\s*db\s*,\s*['"`]([A-Za-z0-9_]+)['"`]/g
    const used = new Map<string, string>()
    for (const file of walk(join(root, 'src'))) {
      const src = readFileSync(file, 'utf8')
      for (const m of src.matchAll(re)) {
        if (!used.has(m[1])) used.set(m[1], file.slice(root.length).replace(/\\/g, '/'))
      }
    }

    const missing = [...used.entries()].filter(([name]) => !ruled.has(name))
    const detail = missing.map(([n, f]) => `  - "${n}" (first seen at${f})`).join('\n')
    expect(
      missing,
      `\nCollections read/written in code but with NO \`match\` rule in firestore.rules ` +
        `— these are DENIED for every role once rules deploy:\n${detail}\n`,
    ).toEqual([])
  })
})
