import { useEffect, useRef, useState } from 'react'
import { getModels, getCapabilities, streamChat } from './ollama.js'
import { getPageContent } from './page.js'
import { searchWeb, formatResults, WEB_SEARCH_TOOL } from './websearch.js'
import { SYSTEM_PROMPT, commandList, getCommand, helpText, composeChatMessage } from './commands.js'
import { focusSoon } from './dom.js'
import Message from './Message.jsx'
import Composer from './Composer.jsx'
import EmptyState from './EmptyState.jsx'

const MAX_TOOL_STEPS = 4 // guard against runaway tool-call loops

// Map a UI message to the shape Ollama wants, preserving tool fields.
function toApi(m) {
  const out = { role: m.role, content: m.content ?? '' }
  if (m.tool_calls) out.tool_calls = m.tool_calls
  if (m.tool_name) out.tool_name = m.tool_name
  return out
}

export default function SidePanel() {
  const [models, setModels] = useState([])
  const [selectedModel, setSelectedModel] = useState('')
  const [status, setStatus] = useState('loading') // 'loading' | 'ready' | 'error'
  const [error, setError] = useState('')

  const [effort, setEffort] = useState('low') // 'low' | 'medium' | 'high'
  const [thinkingSupported, setThinkingSupported] = useState(false)
  const [toolsSupported, setToolsSupported] = useState(false)
  const [webSearch, setWebSearch] = useState(false)

  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [note, setNote] = useState('') // transient status: "Reading page…" etc.

  const abortRef = useRef(null)
  const threadRef = useRef(null)
  const stickyRef = useRef(true)
  const textareaRef = useRef(null)

  useEffect(() => {
    getModels()
      .then((names) => {
        setModels(names)
        setSelectedModel(names[0] ?? '')
        setStatus('ready')
      })
      .catch((err) => {
        setError(err.message)
        setStatus('error')
      })
  }, [])

  // Detect per-model capabilities to gate the effort + web-search controls.
  useEffect(() => {
    if (!selectedModel) return
    let cancelled = false
    getCapabilities(selectedModel)
      .then((caps) => {
        if (cancelled) return
        setThinkingSupported(caps.includes('thinking'))
        setToolsSupported(caps.includes('tools'))
      })
      .catch((err) => {
        if (cancelled) return
        console.error('[Echo] failed to fetch model capabilities:', err)
        setThinkingSupported(false)
        setToolsSupported(false)
      })
    return () => {
      cancelled = true
    }
  }, [selectedModel])

  useEffect(() => {
    if (stickyRef.current && threadRef.current) {
      threadRef.current.scrollTop = threadRef.current.scrollHeight
    }
  }, [messages, note])

  function onThreadScroll() {
    const el = threadRef.current
    if (!el) return
    stickyRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48
  }

  function pushAssistant(content) {
    setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: 'assistant', content }])
  }

  function setAssistant(id, patch) {
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, ...patch } : m)))
  }

  // Runs the model, letting it call the web_search tool when enabled. Loops
  // until the model returns a plain answer (or the step cap is hit).
  async function runConversation(uiMessages) {
    stickyRef.current = true
    const assistantId = crypto.randomUUID()
    setMessages([...uiMessages, { id: assistantId, role: 'assistant', content: '' }])
    setStreaming(true)

    const controller = new AbortController()
    abortRef.current = controller

    const useTools = webSearch && toolsSupported
    let apiMessages = [SYSTEM_PROMPT, ...uiMessages.map(toApi)]
    let sources = []
    let finalContent = ''

    try {
      for (let step = 0; step < MAX_TOOL_STEPS; step++) {
        // On the last allowed step, withhold the tool so the model is forced
        // to answer in plain text — otherwise a model that keeps calling
        // web_search could exhaust every step and leave the reply blank.
        const allowTools = useTools && step < MAX_TOOL_STEPS - 1
        setNote(step === 0 ? 'Thinking…' : 'Reading search results…')
        let gotFirstToken = false

        const { content, toolCalls } = await streamChat({
          model: selectedModel,
          messages: apiMessages,
          think: thinkingSupported ? effort : undefined,
          tools: allowTools ? [WEB_SEARCH_TOOL] : undefined,
          signal: controller.signal,
          onToken: (_delta, full) => {
            if (!gotFirstToken) {
              gotFirstToken = true
              setNote('')
            }
            setAssistant(assistantId, { content: full })
          },
        })
        setNote('')
        finalContent = content
        console.debug('[Echo] chat step', step, { toolCalls, contentLength: content.length })

        if (!toolCalls.length) break // model gave its final answer

        // Record the tool-call turn, run each tool, feed results back.
        apiMessages = [...apiMessages, { role: 'assistant', content: content || '', tool_calls: toolCalls }]
        for (const call of toolCalls) {
          const args = call.function?.arguments || {}
          const query = typeof args === 'string' ? args : args.query || ''
          if (call.function?.name === 'web_search') {
            setNote(`Searching: ${query}`)
            let results = []
            try {
              results = await searchWeb(query, 5)
            } catch (err) {
              console.error('[Echo] web_search failed:', err)
              results = []
            }
            sources = [...sources, ...results]
            apiMessages = [
              ...apiMessages,
              { role: 'tool', tool_name: 'web_search', content: results.length ? formatResults(results) : 'No results found.' },
            ]
          } else {
            console.warn('[Echo] model requested an unknown tool:', call.function?.name)
            apiMessages = [...apiMessages, { role: 'tool', tool_name: call.function?.name || 'unknown', content: 'Tool not available.' }]
          }
        }
        setAssistant(assistantId, { content: '' }) // clear before the next pass streams
      }

      // Safety net: the forced-final step above should always leave real
      // text, but never let the bubble sit blank (and stuck on the typing
      // dots) if something still slips through.
      if (!finalContent) {
        console.warn('[Echo] tool loop ended with no text — showing fallback message')
        setAssistant(assistantId, {
          content:
            "I couldn't put together an answer, possibly after too many search attempts. " +
            'Try rephrasing, or turn off Web search.',
        })
      }
      if (sources.length) setAssistant(assistantId, { sources })
    } catch (err) {
      if (err.name !== 'AbortError') {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? { ...m, content: (m.content ? m.content + '\n\n' : '') + `⚠️ ${err.message}` }
              : m,
          ),
        )
      }
    } finally {
      // A newer conversation may have already replaced abortRef.current (e.g.
      // Stop/New Chat immediately followed by another send) — only reset
      // shared state if this run is still the current one, so we don't clobber
      // the newer conversation's streaming/note/abortRef.
      if (abortRef.current === controller) {
        setStreaming(false)
        setNote('')
        abortRef.current = null
      }
    }
  }

  async function runPageCommand(cmd, args) {
    setNote('Reading the page…')
    try {
      const page = await getPageContent()
      // Must be awaited: runConversation sets its own "Thinking…" note right
      // after this resolves. Without awaiting, control returns here first and
      // this function's `finally` wipes that note before the first token
      // arrives, leaving a blank gap with no loading indicator at all.
      await runConversation([...messages, { id: crypto.randomUUID(), role: 'user', ...cmd.build({ page, args }) }])
    } catch (err) {
      pushAssistant(`⚠️ ${err.message}`)
    } finally {
      setNote('')
    }
  }

  // Plain chat always tries to attach the current page — that's the whole
  // point of this extension. If the page can't be read (a chrome:// tab, no
  // active tab, etc.) fall back to a plain message instead of blocking chat.
  async function runChat(text) {
    setNote('Reading the page…')
    let page = null
    try {
      page = await getPageContent()
    } catch (err) {
      console.debug('[Echo] no page context for this chat turn:', err.message)
    } finally {
      setNote('')
    }
    runConversation([...messages, { id: crypto.randomUUID(), role: 'user', ...composeChatMessage({ text, page }) }])
  }

  function handleSend(text) {
    if (streaming || note) return
    setInput('')

    if (text.startsWith('/')) {
      const space = text.indexOf(' ')
      const name = (space === -1 ? text.slice(1) : text.slice(1, space)).toLowerCase()
      const args = space === -1 ? '' : text.slice(space + 1).trim()
      const cmd = getCommand(name)
      if (!cmd) return pushAssistant(`Unknown command **/${name}**. Type **/help** for the list.`)
      if (cmd.local === 'help') return pushAssistant(helpText())
      if (cmd.local === 'clear') return newChat()
      if (cmd.needsPage) return runPageCommand(cmd, args)
      return
    }

    runChat(text)
  }

  function prefillCommand(name) {
    setInput('/' + name + ' ')
    focusSoon(textareaRef)
  }

  function handleStop() {
    abortRef.current?.abort()
  }

  function newChat() {
    if (streaming) abortRef.current?.abort()
    setMessages([])
    setInput('')
    focusSoon(textareaRef)
  }

  const webActive = webSearch && toolsSupported

  return (
    <div className="app">
      <header className="appbar">
        <div className="appbar__brand">
          <img className="appbar__logo" src="/icons/128.png" alt="" width="22" height="22" />
          <span className="appbar__name">Echo</span>
        </div>
        <button
          className="appbar__new"
          onClick={newChat}
          disabled={messages.length === 0 && !streaming}
          title="New chat"
          aria-label="New chat"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
            <path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4Z" />
          </svg>
          <span>New chat</span>
        </button>
      </header>

      {status === 'ready' && (
        <div className="toolbar">
          <select
            className="toolbar__select"
            value={selectedModel}
            onChange={(e) => setSelectedModel(e.target.value)}
            title="Model"
          >
            {models.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>

          <select
            className="toolbar__select"
            value={effort}
            onChange={(e) => setEffort(e.target.value)}
            disabled={!thinkingSupported}
            title={thinkingSupported ? 'Reasoning effort' : 'This model has no reasoning-effort setting'}
          >
            <option value="low">Effort: Low</option>
            <option value="medium">Effort: Med</option>
            <option value="high">Effort: High</option>
          </select>

          <button
            className={`toolbar__web ${webActive ? 'is-on' : ''}`}
            onClick={() => setWebSearch((v) => !v)}
            disabled={!toolsSupported}
            title={
              toolsSupported
                ? 'Web search — the model may query DuckDuckGo when it needs current facts'
                : "This model can't call tools, so web search is unavailable"
            }
            aria-pressed={webActive}
          >
            🔎 Web
          </button>
        </div>
      )}

      <main className="thread" ref={threadRef} onScroll={onThreadScroll}>
        {status === 'loading' && <p className="notice">Connecting to Ollama…</p>}

        {status === 'error' && (
          <div className="notice notice--error">
            <p><strong>Couldn't reach Ollama.</strong> {error}</p>
            <p>
              Start Ollama with this extension allowed as an origin:
              <br />
              <code>OLLAMA_ORIGINS={`chrome-extension://${chrome.runtime.id}`}</code>
              <br />
              See the README for the exact command on macOS, Linux, or Windows.
            </p>
          </div>
        )}

        {status === 'ready' && messages.length === 0 && !note && (
          <EmptyState commands={commandList} busy={streaming} onRun={prefillCommand} />
        )}

        {messages.map((m) => (
          <Message key={m.id} message={m} />
        ))}

        {note && <p className="notice notice--inline">{note}</p>}
      </main>

      {status === 'ready' && (
        <footer className="footer">
          <Composer
            commands={commandList}
            value={input}
            onChange={setInput}
            onSubmit={handleSend}
            textareaRef={textareaRef}
            disabled={status !== 'ready' || !!note}
            streaming={streaming}
            onStop={handleStop}
          />
        </footer>
      )}
    </div>
  )
}
