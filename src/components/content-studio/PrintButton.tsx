export function PrintButton({ label = 'Export PDF' }: { label?: string }) {
  return (
    <button className="btn-primary no-print" onClick={() => window.print()}>
      ⤓ {label}
    </button>
  )
}
