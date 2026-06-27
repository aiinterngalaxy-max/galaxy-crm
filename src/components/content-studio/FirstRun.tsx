import { SeedButton } from './SeedButton'
import { Page } from './ui'

// Shown when the cmo_* tables are missing/empty (fresh database).
export function FirstRun({ error, onSeeded }: { error?: string; onSeeded?: () => void }) {
  return (
    <Page>
      <div className="glass-card p-8 max-w-2xl mx-auto mt-10 text-center">
        <div className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-gray-800 text-gold-500 text-2xl font-extrabold mb-4">
          G
        </div>
        <h1 className="text-xl font-bold text-gray-100">Set up Content Command</h1>
        <p className="text-sm text-gray-500 mt-2">
          This dashboard shares Galaxy&apos;s Turso database. The content tables
          (<code className="text-gold-400">cmo_*</code>) aren&apos;t initialised yet. Load the Galaxy marketing
          demo dataset to explore every view — it creates the tables and seeds realistic content, ideas, shoots
          and performance.
        </p>
        <div className="mt-5 flex justify-center">
          <SeedButton onSeeded={onSeeded} />
        </div>
        {error && <p className="mt-4 text-xs text-gray-600">(db note: {error})</p>}
        <p className="mt-6 text-xs text-gray-600">
          Or call <code className="text-gold-400">/api/init?seed=1</code> once after deploy.
        </p>
      </div>
    </Page>
  )
}
