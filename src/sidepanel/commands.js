// Slash-command registry. Each command is either:
//   - local  : handled in the UI (help, clear) — no model call
//   - page   : needs the current tab's text (needsPage: true)
// Plain chat (no slash command) also attaches the current page via
// composeChatMessage() below — this extension's main job is reasoning about
// the page you're on, so page context is the default, not an opt-in.
//
// Prompt-engineering notes (applied throughout):
//   * One global SYSTEM_PROMPT sets role + output rules once.
//   * Page text is wrapped in <page> … </page> so the model can tell
//     instructions from data (also limits prompt-injection from page text).
//   * Every task states an explicit output shape and a grounding rule
//     ("use only the content, say so if absent, never invent").
//   * The user's own words (args typed after the command) are passed through
//     as an explicit "added focus" so the command adapts to what they want.

export const SYSTEM_PROMPT = {
  role: 'system',
  content: [
    'You are Echo, a fast, no-nonsense assistant running on a local model inside a browser side panel.',
    '',
    'Output rules:',
    '- Write clean, minimal GitHub-flavored Markdown: short paragraphs, bullet lists, **bold** for key terms, fenced code blocks for code.',
    '- Be concise and direct. No preamble, no filler, no restating the request.',
    '',
    'Grounding rules:',
    '- The current browser tab\'s content is usually included inside <page> … </page> tags. Use it when the user\'s question relates to the page (e.g. "summarize this", "what does this say about X"); ignore it and answer normally when the question is clearly unrelated to the page (e.g. general knowledge, math, or something about a different topic).',
    '- When you do rely on the page, treat it as the only source of truth for that page and do not mix in outside knowledge about it.',
    '- When web_search tool results are available, use them for current facts and cite the ones you rely on as [n], matching their numbering.',
    '- If the requested information is not in the provided content, say so plainly instead of guessing.',
    '- Never invent facts, quotes, numbers, names, or links.',
  ].join('\n'),
}

// Wrap page text with metadata in a clearly delimited block.
function pageBlock({ title, url, text }) {
  const safeTitle = (title || '').replace(/"/g, "'")
  return `<page title="${safeTitle}" url="${url}">\n${text}\n</page>`
}

/**
 * Compose a plain-chat message that always carries the current page as
 * context, so the assistant can use it whenever it's relevant without the
 * user needing a slash command. `page` may be null if it couldn't be read
 * (browser-internal page, no active tab, etc.) — falls back to plain text.
 */
export function composeChatMessage({ text, page }) {
  if (!page) return { content: text }
  return {
    display: text,
    context: { title: page.title, url: page.url },
    content: `${text}\n\n${pageBlock(page)}`,
  }
}

// Assemble a page-command message. `args` is the user's own text (may be empty).
function composePage({ name, instruction, page, args }) {
  const focus = args ? `\n\nExtra focus from the user: ${args}` : ''
  return {
    display: args ? `/${name} ${args}` : `/${name}`,
    context: { title: page.title, url: page.url },
    content: `${instruction}${focus}\n\n${pageBlock(page)}`,
  }
}

const COMMANDS = [
  { name: 'help', hint: 'List everything Echo can do', local: 'help' },
  {
    name: 'summarize',
    hint: 'TL;DR + key points of the current page',
    needsPage: true,
    instruction:
      'Summarize the page below for a busy reader who has not opened it.\n\n' +
      'Respond in exactly this shape:\n' +
      '**TL;DR** — 2–3 sentences capturing the core point.\n' +
      '**Key points** — 3–6 bullets, each a distinct, concrete takeaway.\n\n' +
      'Keep the whole answer under ~180 words and include only what is in the content.',
  },
  {
    name: 'scan_job',
    hint: 'Break down a job posting + keywords to mirror',
    needsPage: true,
    instruction:
      'Analyze the job posting below for a candidate deciding whether to apply and how to tailor their application.\n\n' +
      'Use these sections (skip a section only if the information is truly absent):\n' +
      '**Role** — title, seniority, and location / remote in one line.\n' +
      '**Must-haves** — required skills and experience, as bullets.\n' +
      '**Nice-to-haves** — preferred-but-optional items, as bullets.\n' +
      '**Comp & logistics** — pay, benefits, hours, or visa, if stated.\n' +
      '**⚠️ Watch-outs** — vague, unrealistic, or concerning signals (or "None obvious").\n' +
      '**Keywords to mirror** — comma-separated tech, tools, and terms to echo in a résumé.\n\n' +
      'Base every point strictly on the posting.',
  },
  {
    name: 'keywords',
    hint: 'Pull the key terms and jargon from the page',
    needsPage: true,
    instruction:
      'Extract the most important keywords from the page below, ranked by importance.\n\n' +
      '**Topics** — 5–10 comma-separated key concepts or entities.\n' +
      '**Terms of art** — domain jargon or named tools/technologies, comma-separated.\n\n' +
      'List only; do not explain the terms.',
  },
  {
    name: 'explain',
    hint: 'Explain the page in plain language',
    needsPage: true,
    instruction:
      'Explain what the page below is about, in plain language, for a smart person new to the topic.\n\n' +
      '- Start with a one-sentence "what this is".\n' +
      '- Then 3–5 short bullets covering the core ideas, defining any jargon inline.\n\n' +
      'Keep it under ~150 words. Use a metaphor only if it genuinely clarifies.',
  },
  {
    name: 'questions',
    hint: 'Generate sharp questions about the page',
    needsPage: true,
    instruction:
      'Based on the page below, generate questions that deepen understanding.\n\n' +
      'If it is a job posting: 5 sharp interview questions the candidate should prepare, then 2 smart questions to ask the interviewer.\n' +
      'Otherwise: 5 questions that test whether a reader truly understood the material, ordered simple → deep.\n\n' +
      'Number the questions. Do not answer them.',
  },
  {
    name: 'cover_letter',
    hint: 'Draft a tailored cover letter for this job',
    needsPage: true,
    instruction:
      'Draft a short, specific cover letter for the job posting below.\n\n' +
      '- 3 short paragraphs, ~150–200 words total.\n' +
      '- Open with genuine, specific interest in this role and company, grounded in the posting.\n' +
      "- Middle: connect 2–3 of the posting's must-haves to relevant experience, using [bracketed placeholders] like [your project] where personal details are needed.\n" +
      '- Close with a brief, confident call to action.\n' +
      '- Professional but human. No clichés like "I am writing to apply", and never invent facts about the candidate.',
  },
  { name: 'clear', hint: 'Start a new conversation', local: 'clear' },
]

// Attach a build() to every page command using its instruction.
for (const c of COMMANDS) {
  if (c.needsPage) {
    c.build = ({ page, args }) =>
      composePage({ name: c.name, instruction: c.instruction, page, args })
  }
}

export const commandList = COMMANDS.map(({ name, hint, needsPage, local }) => ({
  name,
  hint,
  needsPage: !!needsPage,
  local: local ?? null,
}))

export function getCommand(name) {
  return COMMANDS.find((c) => c.name === name.toLowerCase()) ?? null
}

/** Markdown body for the /help command (rendered locally, no model call). */
export function helpText() {
  const lines = COMMANDS.map((c) => `- **/${c.name}** — ${c.hint}`).join('\n')
  return (
    '**Commands**\n\n' +
    lines +
    '\n\nSelect one and add your own focus before sending — e.g. ' +
    '`/summarize in one sentence`. Or just type a message to chat normally — the ' +
    "current page is always attached, so you can ask about it directly without a command."
  )
}
