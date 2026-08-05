import { useEffect, useRef, useState } from 'react'

export default function SearchBar() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [status, setStatus] = useState('idle')
  const [message, setMessage] = useState('')
  const [open, setOpen] = useState(false)
  const blurTimer = useRef(null)

  useEffect(() => {
    const cleanQuery = query.trim().replace(/\s+/g, ' ')
    if (!cleanQuery) {
      setResults([])
      setStatus('idle')
      setMessage('')
      return undefined
    }

    const controller = new AbortController()
    setStatus('loading')
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/search?q=${encodeURIComponent(cleanQuery)}&limit=5`, { signal: controller.signal })
        const payload = await response.json()
        if (!response.ok) throw new Error(payload.error?.message || 'Search is unavailable right now.')
        setResults(payload.data || [])
        setStatus('success')
      } catch (error) {
        if (error.name === 'AbortError') return
        setResults([])
        setMessage(error.message || 'Search is unavailable right now.')
        setStatus('error')
      }
    }, 300)

    return () => {
      controller.abort()
      window.clearTimeout(timer)
    }
  }, [query])

  useEffect(() => () => window.clearTimeout(blurTimer.current), [])

  function showResults() {
    window.clearTimeout(blurTimer.current)
    if (query.trim()) setOpen(true)
  }

  function hideResults() {
    blurTimer.current = window.setTimeout(() => setOpen(false), 150)
  }

  return (
    <div className="search-bar" onFocus={showResults} onBlur={hideResults}>
      <label className="search-bar__field">
        <span className="visually-hidden">Search Buyamia</span>
        <svg className="search-bar__icon" viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="10.8" cy="10.8" r="5.2" />
          <path d="m15 15 4.3 4.3" />
        </svg>
        <input
          type="search"
          value={query}
          onChange={(event) => { setQuery(event.target.value); setOpen(true) }}
          placeholder="Search"
          aria-label="Search Buyamia"
        />
      </label>
      {open && query.trim() && (
        <div className="search-bar__results" role="status" aria-live="polite">
          {status === 'loading' && <p className="search-bar__state">Searching…</p>}
          {status === 'error' && <p className="search-bar__state">{message}</p>}
          {status === 'success' && results.length === 0 && <p className="search-bar__state">No results found.</p>}
          {status === 'success' && results.map((result) => (
            <a className="search-result" href={result.href} key={`${result.type}-${result.id}`}>
              {result.image && <img src={result.image} alt="" />}
              <span><small>{result.type.replaceAll('-', ' ')}</small><strong>{result.title}</strong><em>{result.description}</em></span>
            </a>
          ))}
        </div>
      )}
    </div>
  )
}
