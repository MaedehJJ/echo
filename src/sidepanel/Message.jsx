import { renderMarkdown } from './markdown.js'

export default function Message({ message }) {
  const isUser = message.role === 'user'
  const label = message.display ?? message.content

  // While the assistant has no content yet, the inline status note in
  // SidePanel ("Thinking…", "Searching: …") is the sole loading indicator —
  // don't also render an empty bubble here.
  if (!isUser && !message.content && !message.sources?.length) return null

  return (
    <div className={`msg msg--${isUser ? 'user' : 'assistant'}`}>
      {message.context && (
        <a
          className="msg__source"
          href={message.context.url}
          target="_blank"
          rel="noreferrer"
          title={message.context.url}
        >
          🔗 {message.context.title || message.context.url}
        </a>
      )}

      {isUser ? (
        <div className="msg__bubble">{label}</div>
      ) : (
        <div
          className="msg__md"
          dangerouslySetInnerHTML={{ __html: renderMarkdown(message.content) }}
        />
      )}

      {message.sources?.length > 0 && (
        <div className="msg__sources">
          <span className="msg__sources-label">🔎 Sources</span>
          {message.sources.map((s, i) => (
            <a
              key={s.url + i}
              className="msg__source"
              href={s.url}
              target="_blank"
              rel="noreferrer"
              title={s.url}
            >
              {i + 1}. {s.title || s.url}
            </a>
          ))}
        </div>
      )}
    </div>
  )
}
