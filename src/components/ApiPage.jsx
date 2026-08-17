const endpoints = [
  ['GET', '/api/health', 'Check API availability.'],
  ['GET', '/api/categories', 'List marketplace categories.'],
  ['GET', '/api/products', 'Browse available products.'],
  ['GET', '/api/search?q={query}', 'Search supported marketplace resources.'],
  ['GET', '/api/auth/session', 'Read the current cookie-based session.'],
]

export default function ApiPage() {
  return (
    <main className="support-page shell">
      <section className="support-intro">
        <p className="eyebrow">Developers</p>
        <h1>Buyamia <em>API</em></h1>
        <p>The application uses a JSON HTTP API under the local <code>/api</code> base path.</p>
      </section>
      <section className="support-tickets">
        <h2>Available endpoints</h2>
        {endpoints.map(([method, path, description]) => <article key={`${method}-${path}`}><span><small>{method}</small><strong><code>{path}</code></strong><p>{description}</p></span></article>)}
      </section>
      <section className="support-faq">
        <div><p className="eyebrow">Authentication</p><h2>Session access</h2></div>
        <p>Authenticated operations use the HTTP-only Buyamia session cookie. No public API key or externally versioned developer API is currently configured.</p>
      </section>
    </main>
  )
}
