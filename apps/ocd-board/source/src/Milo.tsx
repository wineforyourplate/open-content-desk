import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Bot, Loader2, Send, SquarePen, StopCircle } from 'lucide-react'
import { useConversationMessages } from 'lemma-sdk/react'
import { lemmaClient } from './lemma-client'

const STORAGE_KEY = 'ocd:milo-conversation'

const STARTERS = [
  'Save this idea',
  'Find related work',
  'Clean up my board',
  'Make a Reddit version',
  'What should I schedule next?',
]

export function Milo() {
  const [session, setSession] = useState(0)
  const [conversationId, setConversationId] = useState<string | null>(() => localStorage.getItem(STORAGE_KEY))

  function newChat() {
    localStorage.removeItem(STORAGE_KEY)
    setConversationId(null)
    setSession((value) => value + 1)
  }

  return (
    <div className="main milo-page">
      <div className="topbar milo-topbar">
        <div className="milo-identity">
          <span className="milo-avatar"><Bot size={17} /></span>
          <span><strong>Milo</strong><small>Content operator</small></span>
        </div>
        <button className="ghost" onClick={newChat}><SquarePen size={15} /> New chat</button>
      </div>
      <MiloSession
        key={session}
        initialConversationId={conversationId}
        onConversation={(id) => {
          setConversationId(id)
          localStorage.setItem(STORAGE_KEY, id)
        }}
      />
    </div>
  )
}

function MiloSession({
  initialConversationId,
  onConversation,
}: {
  initialConversationId: string | null
  onConversation: (id: string) => void
}) {
  const [input, setInput] = useState('')
  const [isStarting, setIsStarting] = useState(false)
  const endRef = useRef<HTMLDivElement>(null)
  const sendInFlight = useRef(false)
  const thread = useConversationMessages({
    client: lemmaClient,
    agentName: 'milo',
    conversationId: initialConversationId,
    autoResume: true,
    syncOnTurnEnd: true,
  })

  const visibleMessages = thread.messages.filter((message) => (
    message.role === 'user'
    || (message.role === 'assistant' && message.kind === 'TEXT' && !!message.metadata?.is_final_answer)
  ))
  const isBusy = isStarting || thread.isRunning

  useEffect(() => {
    if (thread.conversationId && thread.conversationId !== initialConversationId) onConversation(thread.conversationId)
  }, [initialConversationId, onConversation, thread.conversationId])

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [thread.messages.length, thread.streamingText])

  async function send(text: string) {
    const value = text.trim()
    if (!value || isBusy || sendInFlight.current) return
    sendInFlight.current = true
    setIsStarting(!thread.conversationId)
    setInput('')
    try {
      let activeConversationId = thread.conversationId
      if (!activeConversationId) {
        const conversation = await thread.createConversation({
          agentName: 'milo',
          title: value.slice(0, 80),
          setActive: true,
        })
        activeConversationId = conversation.id
        onConversation(activeConversationId)
      }
      await thread.sendMessage(value, { conversationId: activeConversationId })
    } catch {
      setInput(value)
    } finally {
      sendInFlight.current = false
      setIsStarting(false)
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    void send(input)
  }

  return (
    <div className="milo-workspace">
      <div className="milo-thread" aria-live="polite">
        {!visibleMessages.length && !isBusy ? (
          <div className="milo-welcome">
            <span className="milo-welcome-mark"><Bot size={22} /></span>
            <h1>What are we working on?</h1>
            <p>I can capture, find, organize, shape, and schedule your content.</p>
            <div className="milo-starters">
              {STARTERS.map((starter) => <button key={starter} onClick={() => setInput(starter)}>{starter}</button>)}
            </div>
          </div>
        ) : null}

        {visibleMessages.map((message) => (
          <article className={`milo-message ${message.role}`} key={message.id}>
            {message.role === 'assistant' ? <span className="milo-message-avatar"><Bot size={14} /></span> : null}
            <div>{message.text}</div>
          </article>
        ))}

        {isBusy ? (
          <article className="milo-message assistant working">
            <span className="milo-message-avatar"><Bot size={14} /></span>
            <div>{isStarting
              ? <span className="milo-thinking"><Loader2 className="spin" size={14} /> Starting Milo…</span>
              : thread.streamingText || <span className="milo-thinking"><Loader2 className="spin" size={14} /> Working…</span>}
            </div>
          </article>
        ) : null}

        {thread.error ? (
          <div className="milo-error">Milo hit a snag: {thread.error.message}</div>
        ) : null}
        <div ref={endRef} />
      </div>

      <form className="milo-composer" onSubmit={submit}>
        <textarea
          value={input}
          placeholder="Message Milo…"
          rows={1}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              void send(input)
            }
          }}
        />
        {thread.isRunning ? (
          <button type="button" className="milo-send" title="Stop" onClick={() => void thread.stop()}><StopCircle size={17} /></button>
        ) : (
          <button className="milo-send" title="Send" disabled={!input.trim() || isStarting}>{isStarting ? <Loader2 className="spin" size={16} /> : <Send size={16} />}</button>
        )}
        <small>Milo can edit your pod. It never publishes.</small>
      </form>
    </div>
  )
}
