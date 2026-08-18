import { useEffect, useRef, useState } from 'react'

const initialMessages = [
  {
    id: 1,
    role: 'assistant',
    text: 'Hi there 👋 I am Amia, powered by Buyamia. How can I help?',
    time: '1 min ago',
  },
]

const prompts = ['Discover products', 'About Amia', 'Affiliate Program', 'Procurement Solutions']

function ChatHeader({ onClose }) {
  return (
    <header className="amia-chat__header">
      <span className="amia-chat__mark" aria-hidden="true">✦</span>
      <span>Tell us what you need. We&apos;ll find it.</span>
      <button type="button" onClick={onClose} aria-label="Minimize Amia chat">⌄</button>
    </header>
  )
}

function ProductSuggestions({ products }) {
  return (
    <div className="amia-chat__products">
      {products.map((product) => (
        <a href={product.id ? `/products/${product.id}` : '/categories'} key={product.id || product.title}>
          <img src={product.image} alt="" />
          <span><strong>{product.title}</strong><small>{product.offer || product.priceLabel}<i>☆ {product.rating || 5}/5</i></small></span>
        </a>
      ))}
    </div>
  )
}

function ChatMessage({ message }) {
  return (
    <article className={`amia-message amia-message--${message.role}`}>
      <div className="amia-message__bubble">
        <p>{message.text}</p>
        {message.products && <ProductSuggestions products={message.products} />}
      </div>
      <small>{message.role === 'assistant' ? 'Amia · AI Agent' : 'You'} · {message.time}</small>
    </article>
  )
}

function ChatInput({ value, onChange, onSend }) {
  const recognitionRef = useRef(null)
  const initialValueRef = useRef('')
  const stoppingRef = useRef(false)
  const [listening, setListening] = useState(false)
  const [voiceMessage, setVoiceMessage] = useState('')
  const SpeechRecognition = typeof window === 'undefined' ? null : window.SpeechRecognition || window.webkitSpeechRecognition

  useEffect(() => () => {
    stoppingRef.current = true
    recognitionRef.current?.abort()
  }, [])

  function stopListening() {
    stoppingRef.current = true
    recognitionRef.current?.stop()
    setListening(false)
    setVoiceMessage('Voice input stopped. You can edit your message before sending.')
  }

  function toggleVoiceInput() {
    if (listening) return stopListening()
    if (!SpeechRecognition) {
      setVoiceMessage('Voice input is not supported by this browser. You can continue typing.')
      return
    }
    const recognition = new SpeechRecognition()
    recognitionRef.current = recognition
    stoppingRef.current = false
    initialValueRef.current = value.trim()
    recognition.lang = document.documentElement.lang || navigator.language || 'en-US'
    recognition.continuous = true
    recognition.interimResults = true
    recognition.onstart = () => { setListening(true); setVoiceMessage('Listening… Click the microphone again to stop.') }
    recognition.onresult = (event) => {
      const transcript = Array.from(event.results).map((result) => result[0]?.transcript || '').join(' ').trim()
      onChange([initialValueRef.current, transcript].filter(Boolean).join(' '))
    }
    recognition.onerror = (event) => {
      setListening(false)
      if (event.error === 'aborted' && stoppingRef.current) return setVoiceMessage('Voice input stopped.')
      const errors = {
        'not-allowed': 'Microphone permission was denied. Check your browser permissions and try again.',
        'service-not-allowed': 'Voice recognition is not available in this browser.',
        'audio-capture': 'No microphone is available. Check your audio device and try again.',
        'no-speech': 'No speech was detected. Try again when you are ready.',
        network: 'Voice recognition is temporarily unavailable. Please try again.',
      }
      setVoiceMessage(errors[event.error] || 'Voice input could not be completed. Please try again.')
    }
    recognition.onend = () => {
      recognitionRef.current = null
      setListening(false)
      if (!stoppingRef.current) setVoiceMessage((current) => current.startsWith('Listening') ? 'Voice input finished. You can edit your message before sending.' : current)
    }
    try { recognition.start() } catch { setListening(false); setVoiceMessage('Voice input could not start. Please try again.') }
  }

  function send() {
    if (listening) stopListening()
    onSend()
  }

  function handleKeyDown(event) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      send()
    }
  }

  return (
    <div className="amia-chat__composer">
      <textarea
        value={value}
        onChange={(event) => { onChange(event.target.value); setVoiceMessage('') }}
        onKeyDown={handleKeyDown}
        placeholder="Ask a question..."
        aria-label="Message Amia"
      />
      <div className="amia-chat__tools" aria-hidden="true"><span>⌕</span><span>☺</span><span>♩</span></div>
      {voiceMessage && <p className="amia-chat__voice-status" role="status">{voiceMessage}</p>}
      <button className={`amia-chat__voice${listening ? ' is-listening' : ''}`} type="button" onClick={toggleVoiceInput} disabled={!SpeechRecognition} aria-label={listening ? 'Stop voice input' : 'Use voice input'} aria-pressed={listening} title={SpeechRecognition ? (listening ? 'Stop voice input' : 'Use voice input') : 'Voice input is not supported by this browser'}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Zm-6-3a6 6 0 0 0 12 0M12 17v4m-3 0h6" /></svg></button>
      <button className="amia-chat__send" type="button" onClick={send} disabled={!value.trim()} aria-label="Send message">↑</button>
    </div>
  )
}

function requestAuth() { window.dispatchEvent(new CustomEvent('buyamia:auth-required', { detail: { mode: 'login' } })) }

export default function ChatWindow() {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState(initialMessages)
  const [draft, setDraft] = useState('')
  const [typing, setTyping] = useState(false)
  const [conversationId, setConversationId] = useState(null)
  const [error, setError] = useState('')
  const historyRef = useRef(null)

  useEffect(() => {
    if (open && historyRef.current) historyRef.current.scrollTop = historyRef.current.scrollHeight
  }, [messages, open, typing])

  async function sendMessage(text = draft) {
    const cleanText = text.trim()
    if (!cleanText || typing) return
    const optimistic = { id: Date.now(), role: 'user', text: cleanText, time: 'Just now' }
    setMessages((current) => [...current, optimistic])
    setDraft('')
    setTyping(true)
    setError('')
    try {
      const response = await fetch('/api/ask-amia/chat', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: cleanText, conversationId }) })
      const payload = await response.json()
      if (response.status === 401) requestAuth()
      if (!response.ok) throw new Error(payload.error?.message || 'Amia is unavailable right now.')
      setConversationId(payload.data.conversationId)
      const assistant = {
        id: payload.data.assistantMessage.id,
        role: 'assistant',
        text: payload.data.assistantMessage.text,
        time: 'Just now',
        products: payload.data.assistantMessage.result?.products?.map((product) => ({
          ...product,
          priceLabel: new Intl.NumberFormat('en-US', { style: 'currency', currency: product.currency || 'IDR', maximumFractionDigits: 0 }).format(product.price || 0),
        })),
      }
      setMessages((current) => [...current, assistant])
    } catch (caught) {
      setDraft(cleanText)
      setError(caught.message)
      setMessages((current) => current.filter((message) => message !== optimistic))
    } finally {
      setTyping(false)
    }
  }

  return (
    <section className={`amia-chat${open ? ' is-open' : ''}`} aria-label="Amia AI chat">
      {!open && (
        <button className="amia-chat__launcher" type="button" onClick={() => setOpen(true)} aria-expanded="false">
          <span aria-hidden="true">✦</span><span className="amia-chat__launcher-label">Chat with Amia</span><span aria-hidden="true">⌃</span>
        </button>
      )}
      {open && (
        <div className="amia-chat__window">
          <ChatHeader onClose={() => setOpen(false)} />
          <div className="amia-chat__history" ref={historyRef}>
            {messages.map((message) => <ChatMessage message={message} key={message.id} />)}
            {typing && <div className="amia-chat__typing" aria-label="Amia is typing"><span /><span /><span /></div>}
          </div>
          {messages.length === 1 && <div className="amia-chat__prompts">
            {prompts.map((prompt) => <button type="button" onClick={() => sendMessage(prompt)} key={prompt}>{prompt}</button>)}
          </div>}
          <ChatInput value={draft} onChange={setDraft} onSend={() => sendMessage()} />
          {error && <p className="amia-chat__privacy" role="alert">{error}</p>}
          <p className="amia-chat__privacy">By chatting with Amia, you agree to our <u>Privacy Policy.</u></p>
        </div>
      )}
    </section>
  )
}
