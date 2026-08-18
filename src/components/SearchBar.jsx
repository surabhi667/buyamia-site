import { useEffect, useRef, useState } from 'react'
import { navigateTo, routeForSearchResult } from '../navigation'
import { clearedSearchState, searchKeyboardAction } from '../searchInteractions'

export default function SearchBar({ onNavigate = navigateTo }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [status, setStatus] = useState('idle')
  const [message, setMessage] = useState('')
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const blurTimer = useRef(null)

  useEffect(() => {
    const cleanQuery = query.trim().replace(/\s+/g, ' ')
    if (!cleanQuery) {
      setResults([])
      setStatus('idle')
      setMessage('')
      setOpen(false)
      setActiveIndex(-1)
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
        setActiveIndex(payload.data?.length ? 0 : -1)
      } catch (error) {
        if (error.name === 'AbortError') return
        setResults([])
        setMessage(error.message || 'Search is unavailable right now.')
        setStatus('error')
        setActiveIndex(-1)
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

  function clearSearch() {
    const next = clearedSearchState()
    setQuery(next.query)
    setResults(next.results)
    setStatus(next.status)
    setMessage(next.message)
    setOpen(next.open)
    setActiveIndex(next.activeIndex)
  }

  function chooseResult(result) {
    const destination = routeForSearchResult(result)
    clearSearch()
    onNavigate(destination)
  }

  function keyDown(event) {
    const action = searchKeyboardAction({ key: event.key, open, activeIndex, resultCount: results.length })
    if (action.type === 'close') {
      event.preventDefault()
      setOpen(false)
      setActiveIndex(-1)
      return
    }
    if (action.type === 'highlight') {
      event.preventDefault()
      setOpen(action.open)
      setActiveIndex(action.activeIndex)
      return
    }
    if (action.type === 'select') {
      event.preventDefault()
      chooseResult(results[action.activeIndex])
    }
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
          onChange={(event) => { setQuery(event.target.value); setOpen(Boolean(event.target.value.trim())) }}
          onKeyDown={keyDown}
          placeholder="Search"
          aria-label="Search Buyamia"
          aria-expanded={open && Boolean(query.trim())}
          aria-controls="search-results"
          aria-activedescendant={activeIndex >= 0 ? `search-result-${results[activeIndex]?.type}-${results[activeIndex]?.id}` : undefined}
        />
      </label>
      {open && query.trim() && (
        <div className="search-bar__results" id="search-results" role="listbox" aria-live="polite">
          {status === 'loading' && <p className="search-bar__state">Searching…</p>}
          {status === 'error' && <p className="search-bar__state">{message}</p>}
          {status === 'success' && results.length === 0 && <p className="search-bar__state">No results found.</p>}
          {status === 'success' && results.map((result, index) => (
            <a
              className={`search-result${index === activeIndex ? ' is-active' : ''}${!result.image ? ' search-result--no-image' : ''}`}
              href={routeForSearchResult(result)}
              id={`search-result-${result.type}-${result.id}`}
              key={`${result.type}-${result.id}`}
              role="option"
              aria-selected={index === activeIndex}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={(event) => { event.preventDefault(); chooseResult(result) }}
            >
              {result.image && <img src={result.image} alt="" />}
              <span><small>{result.type.replaceAll('-', ' ')}</small><strong>{result.title}</strong><em>{result.description}</em></span>
            </a>
          ))}
        </div>
      )}
    </div>
  )
}
