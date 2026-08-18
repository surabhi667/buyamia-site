import { useEffect, useState } from 'react'
import { LeftSidebar, RightSidebar } from './components/Sidebars'
import ChatWindow from './components/ChatWindow'
import SearchBar from './components/SearchBar'
import AccountPage from './components/AccountPage'
import SupportPage from './components/SupportPage'
import ShippingAddressesPage from './components/ShippingAddressesPage'
import SecurityPage from './components/SecurityPage'
import BankAccountsPage from './components/BankAccountsPage'
import OrdersPage from './components/OrdersPage'
import BrowsingHistoryPage from './components/BrowsingHistoryPage'
import WishlistPage from './components/WishlistPage'
import AffiliatePage from './components/AffiliatePage'
import CategoriesPage from './components/CategoriesPage'
import BrandsPage from './components/BrandsPage'
import CreateBrandPage from './components/CreateBrandPage'
import AdminPage from './components/AdminPage'
import SourcePage from './components/SourcePage'
import CartPage from './components/CartPage'
import AskAmiaPage from './components/AskAmiaPage'
import SavedPage from './components/SavedPage'
import SellerExperiencePage from './components/SellerExperiencePage'
import AboutPage from './components/AboutPage'
import CareersPage from './components/CareersPage'
import PressPage from './components/PressPage'
import LegalPage from './components/LegalPage'
import ApiPage from './components/ApiPage'
import AuctionsPage from './components/AuctionsPage'
import MarketplacesPage from './components/MarketplacesPage'
import FlashSalesPage from './components/FlashSalesPage'
import FastSellingPage from './components/FastSellingPage'
import SellerPromotionsPage from './components/SellerPromotionsPage'
import BuyingPoolsPage from './components/BuyingPoolsPage'
import PromoFeedbackPopup from './components/PromoFeedbackPopup'
import ProductPage from './components/ProductPage'
import CreateCategoryPageView from './components/CreateCategoryPage'
import { navigateTo, shoppingRoute } from './navigation'
import { nextBannerIndex, promoBannerMessages } from './promoBanner'
import './App.css'

const categories = [
  'Home Decor',
  'Art',
  'Beauty & Care',
  'Furniture',
  'Clothing & Shoes',
  'Jewelry & Accessories',
  'Toys & Entertainment',
  'Food & Beverage',
]

const featured = [
  {
    id: 'prod-bamboo-table',
    title: 'Eco Friendly Coconut Shell Wood Kitchenware Set',
    image: '/assets/featured-1.png',
    price: 'IDR 1,000,000',
  },
  {
    id: 'prod-stone-table',
    title: 'Stone Pedestal Side Tables',
    image: '/assets/featured-2.png',
    price: 'IDR 1,000,000',
  },
  {
    id: 'prod-accent-chair',
    title: 'Modern Grey Accent Armchair',
    image: '/assets/featured-3.png',
    price: 'IDR 1,000,000',
  },
  {
    id: 'prod-table-lamp',
    title: 'Teal Glass Apothecary Set',
    image: '/assets/featured-4.png',
    price: 'IDR 1,000,000',
  },
]

const decor = [
  {
    id: 'prod-ceramic-vase',
    title: 'Artistic Ceramic Vase',
    image: '/assets/product-2.jpeg',
    price: 'IDR 1,000,000',
  },
  {
    id: 'prod-table-lamp',
    title: 'Mushroom Table Lamp',
    image: '/assets/product-1.jpeg',
    price: 'IDR 1,000,000',
  },
  {
    id: 'prod-ceramic-vase',
    title: 'Abstract Face Sculpture',
    image: '/assets/product-3.jpeg',
    price: 'IDR 1,000,000',
  },
  {
    id: 'prod-bamboo-table',
    title: 'Minimal Wooden Form',
    image: '/assets/product-thumb.png',
    price: 'IDR 1,000,000',
  },
]

const reviews = [
  {
    name: 'Ellen',
    image: '/assets/review-1.png',
    text: 'A short snippet of review for a popular product goes here lorem ipsum dolor amet.',
  },
  {
    name: 'Mark',
    image: '/assets/review-2.png',
    text: 'A short snippet of review for a popular product goes here lorem ipsum dolor amet.',
  },
  {
    name: 'Stacey',
    image: '/assets/review-3.png',
    text: 'A short snippet of review for a popular product goes here lorem ipsum dolor amet.',
  },
]

const categoryRoutes = {
  'Home Decor': '/categories?category=home-decoration',
  Art: '/categories?category=art',
  'Beauty & Care': '/categories?category=beauty-care',
  Furniture: '/categories?category=furniture',
  'Clothing & Shoes': '/categories?category=clothing-shoes',
  'Jewelry & Accessories': '/categories?category=jewelry-accessories',
  'Toys & Entertainment': '/categories?category=toys-entertainment',
  'Food & Beverage': '/categories?category=food-beverage',
}

function goTo(path) {
  navigateTo(path)
}

function ProductCard({ id, title, image, price }) {
  const destination = id ? `/products/${id}` : '/categories'
  function open() { goTo(destination) }
  function key(event) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      open()
    }
  }
  return (
    <article className="product-card" role="button" tabIndex="0" onClick={open} onKeyDown={key}>
      <div className="product-card__media">
        <img src={image} alt={title} />
      </div>
      <h3>{title}</h3>
      <div className="price-row">
        <div className="price-row__top">
          <span>Estimated Price</span>
          <span className="hint">Try a little</span>
        </div>
        <strong>{price}</strong>
      </div>
      <div className="product-card__footer">
        <span className="tag">Living room</span>
        <span>★ 5/5</span>
      </div>
    </article>
  )
}

function CarouselNav() {
  function scroll(amount) {
    window.scrollBy({ left: amount, top: 0, behavior: 'smooth' })
  }
  return (
    <div className="carousel-nav">
      <button type="button" aria-label="Scroll left" onClick={() => scroll(-360)}>←</button>
      <div className="track">
        <span />
      </div>
      <button type="button" aria-label="Scroll right" onClick={() => scroll(360)}>→</button>
    </div>
  )
}

function CreateCategoryPage() {
  return window.location.pathname === '/brands/create' ? <CreateBrandPage /> : <CreateCategoryPageView />
}

function useLocationKey() {
  const current = () => `${window.location.pathname}${window.location.search}${window.location.hash}`
  const [locationKey, setLocationKey] = useState(current)
  useEffect(() => {
    function updateLocation() {
      setLocationKey(current())
    }
    window.addEventListener('popstate', updateLocation)
    window.addEventListener('buyamia:navigate', updateLocation)
    return () => {
      window.removeEventListener('popstate', updateLocation)
      window.removeEventListener('buyamia:navigate', updateLocation)
    }
  }, [])
  return locationKey
}

function TopBanner({ onNavigate }) {
  const [index, setIndex] = useState(0)
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const [reducedMotion, setReducedMotion] = useState(false)
  const message = promoBannerMessages[index]
  const paused = hovered || focused

  useEffect(() => {
    const media = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    if (!media) return undefined
    const update = () => setReducedMotion(media.matches)
    update()
    media.addEventListener?.('change', update)
    return () => media.removeEventListener?.('change', update)
  }, [])

  useEffect(() => {
    if (paused || reducedMotion) return undefined
    const timer = window.setInterval(() => setIndex((current) => nextBannerIndex(current)), 5000)
    return () => window.clearInterval(timer)
  }, [paused, reducedMotion])

  function activate(event) {
    event.preventDefault()
    if (message.action === 'signup') {
      window.dispatchEvent(new CustomEvent('buyamia:auth-required', { detail: { mode: 'signup' } }))
      return
    }
    onNavigate(message.href)
  }

  return (
    <div className="top-banner" onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      <a
        className="top-banner__link"
        href={message.href}
        onClick={activate}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
      >
        <span className="top-banner__message" key={message.id}>{message.text}</span>
        <span aria-hidden="true">{message.arrow}</span>
      </a>
    </div>
  )
}

export default function App() {
  const locationKey = useLocationKey()
  const caravanUrl = import.meta.env.VITE_CARAVAN_URL || 'http://localhost:5176/'
  const [leftOpen, setLeftOpen] = useState(false)
  const [rightOpen, setRightOpen] = useState(false)
  const [amiaPrompt, setAmiaPrompt] = useState('')
  const [webWide, setWebWide] = useState(false)
  const [footerEmail, setFooterEmail] = useState('')
  const [footerMessage, setFooterMessage] = useState('')
  if (window.location.pathname === '/admin') return <AdminPage />
  const isAccountPage = window.location.pathname === '/account'
  const isSupportPage = window.location.pathname === '/support'
  const isShippingAddressesPage = window.location.pathname === '/account/shipping-addresses'
  const isSecurityPage = window.location.pathname === '/account/security'
  const isBankAccountsPage = window.location.pathname === '/account/bank-accounts'
  const isOrdersPage = window.location.pathname === '/account/orders' || window.location.pathname.startsWith('/account/orders/')
  const isBrowsingHistoryPage = window.location.pathname === '/account/history'
  const isWishlistPage = window.location.pathname === '/account/wishlist'
  const isAffiliatePage = window.location.pathname === '/account/affiliate' || window.location.pathname.startsWith('/account/affiliate/')
  const isCategoriesPage = window.location.pathname === '/categories'
  const isCreateCategoryPage = window.location.pathname === '/categories/create' || window.location.pathname === '/brands/create'
  const isBrandsPage = window.location.pathname === '/brands' || window.location.pathname.startsWith('/brands/')
  const isSourcePage = window.location.pathname === '/source'
  const isCartPage = window.location.pathname === '/cart' || window.location.pathname.startsWith('/checkout/')
  const isAskAmiaPage = window.location.pathname === '/ask-amia'
  const isSavedPage = window.location.pathname === '/saved' || window.location.pathname.startsWith('/saved/')
  const isSellerPage = window.location.pathname === '/sell-on-buyamia' || window.location.pathname.startsWith('/sellers/')
  const isAboutPage = window.location.pathname === '/about'
  const isCareersPage = window.location.pathname === '/careers'
  const isPressPage = window.location.pathname === '/press'
  const isLegalPage = window.location.pathname === '/legal'
  const isApiPage = window.location.pathname === '/api-docs'
  const isAuctionsPage = window.location.pathname === '/auctions' || window.location.pathname.startsWith('/auctions/')
  const isMarketplacesPage = window.location.pathname === '/marketplaces' || window.location.pathname.startsWith('/marketplaces/')
  const isFlashSalesPage = window.location.pathname === '/flash-sales' || window.location.pathname.startsWith('/flash-sales/')
  const isFastSellingPage = window.location.pathname === '/fast-selling' || window.location.pathname.startsWith('/fast-selling/')
  const isSellerPromotionsPage = window.location.pathname === '/seller-promotions' || window.location.pathname.startsWith('/seller-promotions/')
  const isBuyingPoolsPage = window.location.pathname === '/buying-pools' || window.location.pathname.startsWith('/buying-pools/')
  const productMatch = window.location.pathname.match(/^\/products\/([^/]+)$/)
  async function joinNewsletter() {
    setFooterMessage('')
    try {
      const response = await fetch('/api/newsletter', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: footerEmail, source: 'home-footer' }) })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error?.message || 'Unable to join.')
      setFooterMessage('Joined.')
    } catch (error) {
      setFooterMessage(error.message)
    }
  }

  return (
    <div className={`site${leftOpen ? ' site--left-open' : ''}${rightOpen ? ' site--right-open' : ''}`}>
      <TopBanner onNavigate={navigateTo} />

      <LeftSidebar open={leftOpen} onToggle={() => setLeftOpen((value) => !value)} />
      <RightSidebar open={rightOpen} onToggle={() => setRightOpen((value) => !value)} />
      <ChatWindow />
      <PromoFeedbackPopup />

      <div className="site-content">

      <header className="site-header">
        <div className="shell site-header__inner">
          <a className="logo" href="/">
            buyamia
          </a>
          <nav className="nav-links" aria-label="Primary">
            <a href="/categories">
              Categories <span className="chevron">▾</span>
            </a>
            <a href="/brands">
              Brands <span className="chevron">▾</span>
            </a>
            <a href="/marketplaces">
              Marketplaces <span className="chevron">▾</span>
            </a>
            <a href="/source">Source</a>
            <a href="/auctions">Auctions</a>
            <a href="/about">About</a>
          </nav>
          <div className="header-actions">
            <a className="text-link" href="/sell-on-buyamia">
              Sell on Buyamia
            </a>
            <button className="btn btn-accent" type="button" onClick={() => goTo(shoppingRoute)}>
              Start Shopping
            </button>
            <SearchBar onNavigate={navigateTo} />
          </div>
        </div>
      </header>

      {isCategoriesPage && <div className="category-create-entry shell"><a className="btn btn-charcoal" href="/categories/create">Create Category</a></div>}

      {isCreateCategoryPage ? <CreateCategoryPage key={locationKey} /> : productMatch ? <ProductPage id={decodeURIComponent(productMatch[1])} key={locationKey} /> : isBuyingPoolsPage ? <BuyingPoolsPage key={locationKey} /> : isSellerPromotionsPage ? <SellerPromotionsPage key={locationKey} /> : isFastSellingPage ? <FastSellingPage key={locationKey} /> : isFlashSalesPage ? <FlashSalesPage key={locationKey} /> : isMarketplacesPage ? <MarketplacesPage key={locationKey} /> : isAuctionsPage ? <AuctionsPage key={locationKey} /> : isApiPage ? <ApiPage /> : isLegalPage ? <LegalPage /> : isPressPage ? <PressPage /> : isCareersPage ? <CareersPage /> : isAboutPage ? <AboutPage /> : isSellerPage ? <SellerExperiencePage key={locationKey} /> : isSavedPage ? <SavedPage key={locationKey} /> : isAskAmiaPage ? <AskAmiaPage key={locationKey} /> : isCartPage ? <CartPage key={locationKey} /> : isAccountPage ? <AccountPage /> : isShippingAddressesPage ? <ShippingAddressesPage /> : isSecurityPage ? <SecurityPage /> : isBankAccountsPage ? <BankAccountsPage /> : isOrdersPage ? <OrdersPage key={locationKey} /> : isBrowsingHistoryPage ? <BrowsingHistoryPage /> : isWishlistPage ? <WishlistPage /> : isAffiliatePage ? <AffiliatePage key={locationKey} /> : isCategoriesPage ? <CategoriesPage key={locationKey} /> : isBrandsPage ? <BrandsPage key={locationKey} /> : isSourcePage ? <SourcePage key={locationKey} /> : isSupportPage ? <SupportPage /> : <>
      <main>
        <section className="shell hero">
          <div className="hero-top">
            <div className="hero-copy">
              <h1>
                The Intelligent <em>Everything</em> Marketplace Network.
              </h1>
              <div>
                <div className="lede">
                  <strong>Sourced from the heart of Indonesia.</strong>
                  <p>
                    Buyamia connects global buyers with Indonesia&apos;s finest artisan makers -
                    from single orders to full container sourcing.
                  </p>
                </div>
                <div className="hero-actions">
                  <a className="btn btn-charcoal" href="/marketplaces">
                    Browse Marketplace
                  </a>
                  <a className="btn btn-accent" href="/sellers/seller-sari">
                    View Supplier Node
                  </a>
                </div>
              </div>
            </div>

            <div className="hero-visual">
              <img src="/assets/hero-field.jpeg" alt="Lush green Indonesian landscape" />
              <div className="hero-ticks" aria-hidden="true">
                <i />
                <i />
                <i />
                <i />
                <i />
              </div>
              <div className="float-card">
                <img src="/assets/product-thumb.png" alt="" />
                <div className="float-card__body">
                  <p>Eco Friendly Bamboo side table</p>
                  <div className="float-card__meta">
                    <span className="discount">-70%</span>
                    <span className="rating">★ 5/5</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="live-panel">
            <aside className="live-side">
              <div className="mode-list">
                <button className="active" type="button" onClick={() => goTo('/flash-sales')}>
                  See live feeds <span>→</span>
                </button>
                <button type="button" onClick={() => window.open(caravanUrl, '_blank', 'noopener,noreferrer')}>Shop with friends</button>
                <button type="button" onClick={() => goTo('/buying-pools')}>Buy in bulk</button>
                <button type="button" onClick={() => goTo('/api-docs')}>Build smarter with Buyamia&apos;s API</button>
              </div>
              <div className="live-preview">
                <span className="live-badge">● Live Now</span>
                <div className="live-preview__row">
                  <img src="/assets/product-thumb.png" alt="" />
                  <div>
                    <p>Eco Friendly Bamboo side table</p>
                    <div className="float-card__meta">
                      <span className="discount">-70%</span>
                      <span className="rating">★ 5/5</span>
                    </div>
                  </div>
                </div>
              </div>
            </aside>

            <div className="live-main">
              <div className="live-main__top">
                <h2>Watch. Discover. Buy – in real time.</h2>
                <div className="creator-row">
                  <div className="creator active">
                    <img src="/assets/avatar-1.png" alt="" />
                    <span>Lorem dolor...</span>
                  </div>
                  <div className="creator">
                    <img src="/assets/avatar-2.png" alt="" />
                    <span>Lorem dolor...</span>
                  </div>
                  <div className="creator">
                    <img src="/assets/avatar-3.png" alt="" />
                    <span>Lorem dolor...</span>
                  </div>
                </div>
              </div>
              <div className="video-row">
                {[1, 2, 3, 4, 5, 6].map((slot) => (
                  <div className="video-slot" key={slot}>
                    <img src={`/assets/featured-${((slot - 1) % 4) + 1}.png`} alt="" />
                    <span className="mute" aria-hidden="true">
                      🔇
                    </span>
                  </div>
                ))}
              </div>
              <CarouselNav />
            </div>
          </div>
        </section>

        <section className="amia" id="amia">
          <div className="shell">
            <p className="eyebrow">Meet Amia · Powered by Buyamia</p>
            <h2>
              Tell us what <em>you need</em>. We&apos;ll find it.
            </h2>
            <p>
              Amia is your personal sourcing assistant - whether you&apos;re looking for a specific
              product, building a full FF&E package, or just starting to explore. Ask in plain
              language. Get real results.
            </p>
            <div className="amia-box">
              <textarea
                value={amiaPrompt}
                onChange={(event) => setAmiaPrompt(event.target.value)}
                placeholder="e.g. 'I'm looking for sustainable rattan furniture for a 20-room boutique hotel...'"
              />
              <div className="amia-box__footer">
                <label className="toggle" role="button" tabIndex="0" aria-pressed={webWide} onClick={() => setWebWide((value) => !value)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setWebWide((value) => !value) } }}>
                  Search Web-Wide
                  <span aria-hidden="true" />
                </label>
                <button className="btn btn-charcoal" type="button" onClick={() => goTo(amiaPrompt.trim() ? `/ask-amia?prompt=${encodeURIComponent(amiaPrompt.trim())}${webWide ? '&webWide=true' : ''}` : `/ask-amia${webWide ? '?webWide=true' : ''}`)}>
                  ✦ Ask Amia
                </button>
              </div>
            </div>
          </div>
        </section>

        <section className="category-band" id="categories">
          <img src="/assets/category-bg.png" alt="" />
          <div className="category-band__inner">
            {categories.map((category) => (
              <button
                className={`chip${category === 'Furniture' ? ' active' : ''}`}
                key={category}
                type="button"
                onClick={() => goTo(categoryRoutes[category] || '/categories')}
              >
                {category}
              </button>
            ))}
          </div>
        </section>

        <section className="section shell" id="featured">
          <div className="section-head">
            <p className="eyebrow">Featured products</p>
            <h2>This week’s top picks</h2>
            <p>Handpicked by our team. Updated weekly. Always worth a look.</p>
          </div>
          <div className="product-grid">
            {featured.map((item) => (
              <ProductCard key={item.title} {...item} />
            ))}
          </div>
          <div style={{ marginTop: 24 }}>
            <CarouselNav />
          </div>
        </section>

        <section className="section shell" id="reviews">
          <div className="section-head">
            <p className="eyebrow">Don&apos;t take our word for it</p>
            <h2>Trusted by buyers around the world</h2>
          </div>
          <div className="reviews">
            {reviews.map((review) => (
              <article className="review-card" key={review.name}>
                <img src={review.image} alt="" />
                <div className="review-card__body">
                  <p>{review.text}</p>
                  <div className="stars">★★★★★</div>
                  <h3>{review.name}</h3>
                  <small>Eco Friendly Coconut Shell Wood Kitchenware Set With 2..</small>
                </div>
              </article>
            ))}
          </div>
          <div style={{ marginTop: 24 }}>
            <CarouselNav />
          </div>
        </section>

        <section className="section shell">
          <div className="section-head spread left">
            <div>
              <p className="eyebrow">Top Categories</p>
              <h2>Home Decorations</h2>
            </div>
            <button className="ghost-btn" type="button" onClick={() => goTo('/categories?category=home-decoration')}>
              Browse More →
            </button>
          </div>
          <div className="product-grid">
            {decor.map((item) => (
              <ProductCard key={item.title} {...item} />
            ))}
          </div>
          <div style={{ marginTop: 24 }}>
            <CarouselNav />
          </div>
        </section>

        <section className="section shell ways" id="ways">
          <div className="section-head">
            <h2>You product, your way</h2>
            <p>
              Start with something that already exists, or build exactly what you have in mind - we
              make both effortless.
            </p>
          </div>
          <div className="ways-grid">
            <div className="ways-left">
              <article className="way-card way-card--tall">
                <h3>
                  Design <em>your own</em>
                </h3>
                <div className="way-visual">
                  <img src="/assets/design-chair.png" alt="" />
                </div>
                <button className="btn btn-accent btn-split" type="button" onClick={() => goTo('/ask-amia?prompt=Build%20your%20own%20package')}>
                  <span>Build your own package with Amia</span>
                  <span className="divider" />
                  <span>→</span>
                </button>
              </article>
              <article className="way-card">
                <div>
                  <h3>
                    Buy together, <em>save together.</em>
                  </h3>
                  <p style={{ marginTop: 12 }}>
                    Businesses near you are ordering from the same suppliers you are. Pool your
                    orders together and unlock bulk pricing none of you could get alone - Amia finds
                    the match and handles the coordination.
                  </p>
                </div>
                <button className="btn btn-charcoal btn-split" type="button" onClick={() => goTo('/buying-pools')}>
                  <span>Join a Buying Pool</span>
                  <span className="divider" />
                  <span>→</span>
                </button>
              </article>
            </div>
            <div className="ways-right">
              <article className="way-card way-card--photo">
                <img className="bg" src="/assets/sculptural.jpeg" alt="" />
                <h3>
                  Shop <em>designer items</em>
                </h3>
                <button className="btn btn-accent btn-split" type="button" onClick={() => goTo('/categories')}>
                  <span>Browse curated collections</span>
                  <span className="divider" />
                  <span>→</span>
                </button>
              </article>
              <article className="soft-panel">
                <img className="bg" src="/assets/carved-bg.png" alt="" />
                <div className="mini-product">
                  <div className="mini-product__img">
                    <img src="/assets/carved-chair.jpeg" alt="Hand carved armchair" />
                  </div>
                  <div className="mini-product__info">
                    <p>Hand carved armchair</p>
                    <div className="price-row">
                      <div className="price-row__top">
                        <span>Estimated Price</span>
                        <span className="hint">Try a little</span>
                      </div>
                      <strong>IDR 1,000,000</strong>
                    </div>
                    <div className="product-card__footer">
                      <span className="tag">Bamboo Collection</span>
                      <span>★ 5/5</span>
                    </div>
                  </div>
                </div>
                <button className="btn btn-charcoal btn-split" type="button" onClick={() => goTo('/fast-selling')}>
                  <span>Shop Best Sellers</span>
                  <span className="divider" />
                  <span>→</span>
                </button>
              </article>
            </div>
          </div>
        </section>

        <section className="section shell impact" id="impact">
          <div className="section-head left">
            <p className="eyebrow">Our Impact Partners</p>
            <h2>Every purchase does more than you think.</h2>
            <p>
              Through our impact partner network, every order made on Buyamia contributes to food
              security, clean water access, and education for Indonesian families and communities.
            </p>
          </div>
          <div className="impact-cards">
            <article className="impact-card">
              <div className="icon" aria-hidden="true">
                🎓
              </div>
              <hr />
              <strong>Scholars of Sustenance</strong>
            </article>
            <article className="impact-card">
              <div className="icon" aria-hidden="true">
                🙂
              </div>
              <hr />
              <strong>Jalin Mimpi</strong>
            </article>
            <article className="impact-card">
              <div className="icon" aria-hidden="true">
                💧
              </div>
              <hr />
              <strong>Terra Water Filter</strong>
            </article>
          </div>
        </section>
      </main>

      <footer className="site-footer" id="sell">
        <div className="shell footer-grid">
          <div>
            <a className="logo" href="/">buyamia</a>
            <p>The intelligent everything marketplace network, sourced from Indonesia.</p>
            <div className="newsletter">
              <input aria-label="Email" placeholder="Email address" type="email" value={footerEmail} onChange={(event) => setFooterEmail(event.target.value)} />
              <button className="btn btn-accent" type="button" onClick={joinNewsletter}>
                Join
              </button>
            </div>
            {footerMessage && <p role="status">{footerMessage}</p>}
          </div>
          <div>
            <h4>Products</h4>
            <ul>
              <li><a href="/marketplaces">Marketplace</a></li>
              <li><a href="/auctions">Auctions</a></li>
              <li><a href="/categories">Collections</a></li>
              <li><a href="/buying-pools">Buying Pools</a></li>
            </ul>
          </div>
          <div>
            <h4>Services</h4>
            <ul>
              <li><a href="/ask-amia">Amia AI</a></li>
              <li><a href="/source">Sourcing</a></li>
              <li><a href="/account/orders">Logistics</a></li>
              <li><a href="/api-docs">API</a></li>
            </ul>
          </div>
          <div>
            <h4>Company</h4>
            <ul>
              <li><a href="/about">About</a></li>
              <li><a href="/about#sustainability">Impact</a></li>
              <li><a href="/careers">Careers</a></li>
              <li><a href="/press">Press</a></li>
            </ul>
          </div>
          <div>
            <h4>Support</h4>
            <ul>
              <li><a href="/support">Help Center</a></li>
              <li><a href="/support#contact">Contact</a></li>
              <li><a href="/sell-on-buyamia">Seller Guide</a></li>
              <li><a href="/legal">Legal</a></li>
            </ul>
          </div>
        </div>
        <div className="shell footer-bottom">
          <span>© 2026 Buyamia. All rights reserved.</span>
          <span>Privacy · Terms · Cookies</span>
        </div>
      </footer>
      </>}
      </div>
    </div>
  )
}
