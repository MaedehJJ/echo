import { useEffect, useMemo, useState } from 'react'

export default function Composer({
  commands,
  value,
  onChange,
  onSubmit,
  textareaRef,
  disabled,
  streaming,
  onStop,
}) {
  const [activeIndex, setActiveIndex] = useState(0)
  const [dismissed, setDismissed] = useState(false) // Esc closes the palette

  // Auto-grow the textarea; re-fit on value change and once after first paint.
  function fit() {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 140) + 'px'
  }
  useEffect(fit, [value]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const id = requestAnimationFrame(fit)
    return () => cancelAnimationFrame(id)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Show the palette only while typing the command *name* — i.e. a leading
  // slash with no space yet. Once a space is added (a completed command +
  // arguments), the menu hides so the user can type freely.
  const matches = useMemo(() => {
    const m = value.match(/^\/(\S*)$/)
    if (!m) return []
    const q = m[1].toLowerCase()
    return commands.filter((c) => c.name.startsWith(q))
  }, [value, commands])

  const menuOpen = matches.length > 0 && !dismissed
  const clampedIndex = Math.min(activeIndex, Math.max(matches.length - 1, 0))

  // Complete the command into the box (with a trailing space) — do NOT send.
  function completeCommand(name) {
    onChange('/' + name + ' ')
    setDismissed(false)
    setActiveIndex(0)
    requestAnimationFrame(() => textareaRef.current?.focus())
  }

  function submit() {
    const text = value.trim()
    if (!text || disabled) return
    onSubmit(text)
  }

  function handleChange(e) {
    onChange(e.target.value)
    setDismissed(false)
    setActiveIndex(0)
  }

  function handleKeyDown(e) {
    if (menuOpen) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setActiveIndex((i) => (i + 1) % matches.length)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setActiveIndex((i) => (i - 1 + matches.length) % matches.length)
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        // Select the command, then wait for the user's input before sending.
        e.preventDefault()
        completeCommand(matches[clampedIndex].name)
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setDismissed(true)
        return
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
  }

  return (
    <div className="composer-wrap">
      {menuOpen && (
        <ul className="cmdmenu" role="listbox">
          {matches.map((c, i) => (
            <li
              key={c.name}
              role="option"
              aria-selected={i === clampedIndex}
              className={`cmdmenu__item ${i === clampedIndex ? 'is-active' : ''}`}
              onMouseEnter={() => setActiveIndex(i)}
              onClick={() => completeCommand(c.name)}
            >
              <span className="cmdmenu__name">/{c.name}</span>
              <span className="cmdmenu__hint">{c.hint}</span>
            </li>
          ))}
        </ul>
      )}

      <div className="composer">
        <textarea
          ref={textareaRef}
          className="composer__input"
          placeholder="Message Echo…  (/ for commands)"
          rows={1}
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
        />
        {streaming ? (
          <button className="composer__btn composer__btn--stop" onClick={onStop} title="Stop">
            <span className="composer__stopsquare" />
          </button>
        ) : (
          <button
            className="composer__btn"
            onClick={submit}
            disabled={disabled || !value.trim()}
            title="Send"
          >
            ↑
          </button>
        )}
      </div>
    </div>
  )
}
