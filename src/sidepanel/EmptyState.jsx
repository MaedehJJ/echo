// A small curated set of commands to surface on the welcome screen.
const FEATURED = ['summarize', 'scan_job', 'keywords', 'explain', 'questions', 'cover_letter']

export default function EmptyState({ commands, onRun, busy }) {
  const byName = Object.fromEntries(commands.map((c) => [c.name, c]))
  const featured = FEATURED.map((n) => byName[n]).filter(Boolean)

  return (
    <div className="empty">
      <img className="empty__mark" src="/icons/128.png" alt="" width="56" height="56" />
      <h2 className="empty__title">Echo</h2>
      <p className="empty__sub">Your local AI side panel. Nothing leaves your machine.</p>

      <p className="empty__lead">Start with a command:</p>
      <div className="empty__cmds">
        {featured.map((c) => (
          <button key={c.name} className="cmd-chip" onClick={() => onRun(c.name)} disabled={busy}>
            <span className="cmd-chip__name">/{c.name}</span>
            <span className="cmd-chip__hint">{c.hint}</span>
          </button>
        ))}
      </div>

      <p className="empty__foot">
        Pick one, add your own focus, then send — or type <kbd>/</kbd> anytime.
      </p>
    </div>
  )
}
