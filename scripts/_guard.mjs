/**
 * Safety catch for the scripts in this folder that delete Firestore data.
 *
 * These scripts wipe whole collections with no prompt, and they live one line
 * away from BACKUP.bat in the same directory listing. A mistaken double-click or
 * a tab-complete typo was enough to lose the lot, and on the Spark plan there is
 * no point-in-time recovery to undo it.
 *
 * Nothing here deletes anything. It counts what a script is about to remove,
 * shows that number, and refuses to continue unless the operator passes an
 * explicit flag that cannot be typed by accident.
 */

const FLAG = '--confirm-delete-production'

/**
 * Call immediately after the getDocs() that collects the doomed documents and
 * before the delete loop, so the count shown is the real one.
 *
 * Exits the process unless the confirmation flag was passed.
 */
export function requireConfirmation(count, description) {
  const scriptName = process.argv[1]?.split(/[\\/]/).pop() ?? 'this script'

  if (count === 0) {
    console.log(`\nNothing to delete — no ${description} found. Stopping.\n`)
    process.exit(0)
  }

  if (process.argv.includes(FLAG)) {
    console.log(`\nConfirmed. Deleting ${count} ${description}…\n`)
    return
  }

  console.error(
    `\n${'='.repeat(68)}\n` +
      `  STOPPED — nothing has been deleted.\n\n` +
      `  ${scriptName} would permanently delete ${count} ${description}.\n` +
      `  There is no undo. Point-in-time recovery needs the Blaze plan and\n` +
      `  this project is on Spark.\n\n` +
      `  Take a backup first:\n` +
      `      double-click scripts\\BACKUP.bat\n\n` +
      `  Then, if you are certain, run it again with:\n` +
      `      node scripts/${scriptName} ${FLAG}\n` +
      `${'='.repeat(68)}\n`,
  )
  process.exit(1)
}
