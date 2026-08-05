import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'

const now = '2026-08-04T10:00:00.000Z'

export const seedData = {
  aboutPage: {
    company: { name: 'Buyamia', eyebrow: 'Intelligent Everything Marketplace', title: 'Built on trust. Backed by transparency.', description: 'Every transaction on Buyamia is supported by verification, quality control, and buyer protection — so you always know exactly who you’re dealing with, and exactly what you’re covered for.', searchPlaceholder: 'Let us find what you are looking for you...' },
    confidence: { eyebrow: 'Quality Control & Shipping', title: 'Order with confidence', cards: [
      { id: 'quality-control', icon: '✓', title: 'Buyer’s Guarantee – Quality Control', summary: 'Quality isn’t an afterthought at Buyamia - it’s built into how we work.', description: 'Our QC inspections are tailored to the specific demands of your order: its quantity, complexity, and location. Each inspection is quoted individually so you only pay for what your order actually needs. Optional, but highly recommended — and consistently worth it.' },
      { id: 'shipping', icon: '▣', title: 'Ship with Buyamia and Save', summary: 'Using our shipping services, you get the guaranteed best rate, negotiated by our expert team with years of experience.', description: 'For only 10% on the product price, we help you ship to wherever you need. All shipping charges are estimated. Additional charges may apply upon clearance.' },
    ] },
    brands: { eyebrow: 'Empowering Business Partners and Brands', title: 'Curated to deliver at any scale.', description: 'Whether your requirement is a curated selection for a boutique or a full procurement order for a 300-room hotel, our brands are equipped to meet it.', items: ['Wood & Soul', 'Bali Bambusa', 'Goodwood', 'Kayu Artisans', 'Sukma Living', 'Teaky'] },
    testimonials: { eyebrow: 'Don’t take our word for it', title: 'Trusted by buyers around the world', items: [
      { id: 'ellen', name: 'Ellen', image: '/assets/review-1.png', rating: 5, text: 'A short snippet of review for a popular product goes here. Thoughtful quality and a smooth sourcing experience.', product: 'Eco Friendly Coconut Shell Wood Kitchenware Set' },
      { id: 'mark', name: 'Mark', image: '/assets/review-2.png', rating: 5, text: 'A short snippet of review for a popular product goes here. Clear communication from first brief to delivery.', product: 'Eco Friendly Coconut Shell Wood Kitchenware Set' },
      { id: 'stacey', name: 'Stacey', image: '/assets/review-3.png', rating: 5, text: 'A short snippet of review for a popular product goes here. The maker and product information inspired confidence.', product: 'Eco Friendly Coconut Shell Wood Kitchenware Set' },
    ] },
    achievement: { eyebrow: 'NVIDIA Inception Program Member', title: 'Buyamia is building the region’s first truly AI-native marketplace – with Nvidia in our corner.', badge: 'NVIDIA Inception Program' },
    verification: { eyebrow: 'Verification Tiers', title: 'Every seller is verified.', tiers: [
      { id: 'registered', icon: '♜', name: 'Registered', description: 'Business identity confirmed. Basic legal and contact information verified.' },
      { id: 'verified', icon: '♢', name: 'Verified', description: 'Business registration, tax documentation, and product category confirmed. Eligible to list and sell on the marketplace.' },
      { id: 'trusted', icon: '✪', name: 'Trusted Partner', description: 'A track record of on-time fulfillment, positive buyer feedback, and consistent quality control. Featured with a distinct badge across the platform.' },
    ] },
    impact: { eyebrow: 'Our Impact Partners', title: 'Every purchase does more than you think.', description: 'Through our impact partner network, every order made on Buyamia contributes to food security, clean water access, and education for Indonesian families and communities.', partners: [{ id: 'sos', icon: '▱', name: 'Scholars of Sustenance' }, { id: 'jalin', icon: '☺', name: 'Jalin Mimpi' }, { id: 'terra', icon: '♨', name: 'Terra Water Filter' }] },
    faq: { eyebrow: 'FAQ', title: 'Frequently asked questions', items: [
      { id: 'verified-seller', question: 'How do I know a seller is verified?', answer: 'Every verified seller displays a badge on their profile and product listings. Open the seller’s profile to see their verification tier.' },
      { id: 'order-protection', question: 'What happens if my order doesn’t arrive as described?', answer: 'Contact Buyamia support. We review the order, seller documentation, and quality-control records to determine the appropriate buyer-protection resolution.' },
      { id: 'quality-control', question: 'Can I request quality control?', answer: 'Yes. Quality-control inspections are tailored and quoted for the size, complexity, and location of your order.' },
      { id: 'shipping', question: 'Can Buyamia arrange international shipping?', answer: 'Yes. Our sourcing team can coordinate shipping estimates and delivery options for international orders.' },
    ] },
    closing: { image: '/assets/hero-field.jpeg', title: 'Stay in the loop.', description: 'Discover new makers, transparent sourcing, and stories from across Indonesia.', action: 'Explore the marketplace' },
    updatedAt: now,
  },
  categories: [
    ['art', 'Art', ['Sculptures', 'Pottery', 'Antique', 'Metal Art', 'Glass Art', 'Functional Art', 'Print', 'Drawings & Paintings', '3D Printing', 'Photography & Prints']],
    ['beauty-care', 'Beauty & Care', ['Skincare', 'Wellness', 'Natural Body Care']],
    ['furniture', 'Furniture', ['Chairs', 'Tables', 'Lighting', 'Outdoor']],
    ['home-decoration', 'Home Decoration', ['Textiles', 'Vases', 'Wall Decor']],
    ['clothing-shoes', 'Clothing & Shoes', ['Womenswear', 'Menswear', 'Footwear']],
    ['food-beverage', 'Food & Beverage', ['Coffee', 'Tea', 'Pantry']],
    ['jewelry-accessories', 'Jewelry & Accessories', ['Jewelry', 'Bags', 'Accessories']],
    ['toys-entertainment', 'Toys & Entertainment', ['Games', 'Toys', 'Collectibles']],
    ['office-supplies', 'Office Supplies', ['Stationery', 'Desk Accessories']],
  ].map(([id, name, children], index) => ({ id, name, slug: id, children, position: index + 1, active: true, createdAt: now, updatedAt: now })),
  products: [
    { id: 'prod-bamboo-table', title: 'Eco Friendly Bamboo Side Table', categoryId: 'furniture', image: '/assets/product-thumb.png', price: 1500000, currency: 'IDR', rating: 5, discountPercent: 50, soldCount: 1500000, featured: true },
    { id: 'prod-stone-table', title: 'Stone Pedestal Side Table', categoryId: 'furniture', image: '/assets/featured-2.png', price: 1200000, currency: 'IDR', rating: 5, discountPercent: 30, soldCount: 5300, featured: true },
    { id: 'prod-accent-chair', title: 'Modern Artisan Accent Chair', categoryId: 'furniture', image: '/assets/featured-3.png', price: 3400000, currency: 'IDR', rating: 5, discountPercent: 70, soldCount: 17000, featured: true },
    { id: 'prod-ceramic-vase', title: 'Artistic Ceramic Vase', categoryId: 'home-decoration', image: '/assets/product-2.jpeg', price: 1000000, currency: 'IDR', rating: 4.8, discountPercent: 15, soldCount: 830, featured: false },
    { id: 'prod-table-lamp', title: 'Artisan Mushroom Table Lamp', categoryId: 'home-decoration', image: '/assets/product-1.jpeg', price: 1800000, currency: 'IDR', rating: 4.9, discountPercent: 20, soldCount: 4200, featured: true },
  ].map((product) => ({ ...product, active: true, createdAt: now, updatedAt: now })),
  marketplaces: [{ id: 'vehicles', name: 'Buyamia Motors', title: 'Let us find your next vehicle.', eyebrow: 'Just describe it.', description: 'Buyamia Motors brings Indonesia’s premium car market online. Browse verified dealerships and private sellers, or tell Amia exactly what you want and let the platform do the work.', heroPrompt: 'Ask Amia to find my car', suggestions: ['Brand', 'Engine Size', 'Make Year', 'Mileage', 'Fleet availability'], categories: [{ id: 'cars', name: 'Cars', image: '/assets/marketplace-cars.png' }, { id: 'bikes', name: 'Bikes', image: '/assets/marketplace-bikes.png' }], active: true, createdAt: now }],
  marketplaceListings: [
    ['vehicle-car-1','cars','Aurelia E7 Luxury Electric Sedan','/assets/marketplace-car.png',1250000000,'individual','dealer-archipelago',2026,1200,'electric',true,true,98],
    ['vehicle-car-2','cars','Nusantara Grand Touring EV','/assets/marketplace-car.png',1180000000,'fleet','dealer-archipelago',2026,350,'electric',true,true,87],
    ['vehicle-car-3','cars','Sagara Executive Electric Saloon','/assets/marketplace-car.png',1325000000,'fleet','dealer-archipelago',2025,4800,'electric',true,false,72],
    ['vehicle-car-4','cars','Merapi Long Range Premium Sedan','/assets/marketplace-car.png',1095000000,'individual','dealer-bali-motors',2025,8200,'electric',true,false,68],
    ['vehicle-bike-1','bikes','Aruna Black Electric Cruiser','/assets/marketplace-bike.png',285000000,'individual','dealer-bali-motors',2026,600,'electric',true,true,94],
    ['vehicle-bike-2','bikes','Garuda Urban Electric Motorcycle','/assets/marketplace-bike.png',245000000,'fleet','dealer-bali-motors',2026,150,'electric',true,true,89],
    ['vehicle-bike-3','bikes','Java Night Touring Cruiser','/assets/marketplace-bike.png',310000000,'fleet','dealer-archipelago',2025,2300,'hybrid',true,false,79],
    ['vehicle-bike-4','bikes','Lombok Performance Roadster','/assets/marketplace-bike.png',275000000,'individual','dealer-bali-motors',2025,5100,'petrol',true,false,65],
  ].map(([id,type,title,image,price,purchaseOption,sellerId,makeYear,mileage,engineType,available,featured,popularity]) => ({ id, marketplaceId: 'vehicles', type, title, description: `${title}, inspected and listed by a verified Buyamia Motors dealership.`, images: [image], price, currency: 'IDR', purchaseOption, sellerId, makeYear, mileage, engineType, available, stock: purchaseOption === 'fleet' ? 8 : 1, featured, popularity, rating: 5, reviewCount: Math.max(1, Math.round(popularity / 4)), verified: true, createdAt: now, updatedAt: now })),
  marketplaceDealers: [
    { id: 'dealer-archipelago', marketplaceId: 'vehicles', name: 'Archipelago Premium Motors', country: 'Indonesia', location: 'Jakarta, Indonesia', logo: '/assets/avatar-1.png', verified: true, approved: true, rating: 5, listingIds: ['vehicle-car-1','vehicle-car-2','vehicle-car-3','vehicle-bike-3'], createdAt: now },
    { id: 'dealer-bali-motors', marketplaceId: 'vehicles', name: 'Bali Electric Motoring', country: 'Indonesia', location: 'Bali, Indonesia', logo: '/assets/avatar-3.png', verified: true, approved: true, rating: 5, listingIds: ['vehicle-car-4','vehicle-bike-1','vehicle-bike-2','vehicle-bike-4'], createdAt: now },
  ],
  brands: [
    { id: 'brand-sari-living', name: 'Sari Living', country: 'Bali, Indonesia', categoryId: 'furniture', description: 'Handcrafted furniture for hospitality and commercial spaces.', logo: '/assets/avatar-1.png', banner: '/assets/featured-2.png', productIds: ['prod-bamboo-table', 'prod-stone-table', 'prod-accent-chair'], featured: true, verified: true, rating: 5, createdAt: now },
    { id: 'brand-nusa-studio', name: 'Nusa Studio', country: 'Yogyakarta, Indonesia', categoryId: 'furniture', description: 'Contemporary Indonesian furniture made for lasting spaces.', logo: '/assets/avatar-3.png', banner: '/assets/featured-3.png', productIds: ['prod-accent-chair', 'prod-bamboo-table'], featured: true, verified: true, rating: 4.9, createdAt: now },
    { id: 'brand-island-objects', name: 'Island Objects', country: 'Jakarta, Indonesia', categoryId: 'home-decoration', description: 'Collectible decor and lighting from Indonesian makers.', logo: '/assets/avatar-2.png', banner: '/assets/product-2.jpeg', productIds: ['prod-ceramic-vase', 'prod-table-lamp'], featured: false, verified: true, rating: 4.8, createdAt: now },
  ],
  sourcingListings: [
    { id: 'source-bamboo-stool', productId: 'prod-bamboo-table', title: 'Eco Friendly Bamboo Stool', country: 'Indonesia', categoryId: 'furniture', sourceType: 'external', sourceLabel: 'Sourced Externally', sourceWebsite: 'example.com', description: 'This item was found by Amia through web-wide research and is not listed directly on Buyamia. Pricing and availability are set by the external retailer and may change without notice.', images: ['/assets/product-thumb.png', '/assets/featured-2.png', '/assets/carved-chair.jpeg', '/assets/design-chair.png'], moq: 10, shipping: ['Air Freight', 'Sea Freight'], customization: true, warranty: false, material: 'Wood · FNP · Rustic', dimensions: '215 cm × 90 cm × 165 cm', weight: '54 kgs', certifications: ['Quality control'], verified: false, createdAt: now },
  ],
  sellerPromotions: [
    { id: 'promo-sari', sellerId: 'seller-sari', sellerName: 'Sari Living', avatar: '/assets/avatar-1.png', category: 'Furniture', text: 'New artisan side tables are available for hospitality projects.', active: true, createdAt: now },
    { id: 'promo-island', sellerId: 'seller-island', sellerName: 'Island Botanics', avatar: '/assets/avatar-2.png', category: 'Beauty & Care', text: 'Handmade wellness essentials are ready for wholesale orders.', active: true, createdAt: now },
    { id: 'promo-nusa', sellerId: 'seller-nusa', sellerName: 'Nusa Studio', avatar: '/assets/avatar-3.png', category: 'Furniture', text: 'Our new sustainable furniture collection has just arrived.', active: true, createdAt: now },
  ],
  sellerApplications: [],
  sellerDocuments: [],
  sellerProfiles: [
    { id: 'seller-sari', userId: 'seller-demo-user', brandId: 'brand-sari-living', companyName: 'Sari Living', displayName: 'Sari Living', email: 'hello@sariliving.example', phone: '+62 361 555 0100', country: 'Indonesia', location: 'Bali, Indonesia', categories: ['furniture', 'home-decoration'], bio: 'Handcrafted furniture for hospitality and commercial spaces, made by Indonesian artisans with thoughtful materials and lasting techniques.', established: 2015, instagram: '@sariliving', impactTags: ['Heritage Craft', 'Eco Materials', 'Sustainable Design', 'Innovation', 'Women Led'], verificationStatus: 'approved', public: true, createdAt: now, updatedAt: now },
  ],
  auctions: [
    { id: 'auction-chair-1', productId: 'prod-accent-chair', sellerId: 'seller-sari', title: 'Modern Artisan Accent Chair', description: 'A sculptural hand-finished chair from an Indonesian furniture studio.', images: ['/assets/featured-3.png'], categoryId: 'furniture', startingPrice: 800000, currentBid: 1000000, reservePrice: 950000, bidIncrement: 50000, bidCount: 3, featured: true, startTime: '2026-01-01T00:00:00.000Z', endTime: '2027-09-15T12:00:00.000Z', status: 'live', createdAt: now },
    { id: 'auction-chair-2', productId: 'prod-accent-chair', sellerId: 'seller-sari', title: 'Coconut Shell Wood Lounge Chair', description: 'Limited-edition lounge chair made for statement hospitality spaces.', images: ['/assets/design-chair.png'], categoryId: 'furniture', startingPrice: 900000, currentBid: 1150000, reservePrice: 1100000, bidIncrement: 50000, bidCount: 7, featured: true, startTime: '2026-01-01T00:00:00.000Z', endTime: '2027-08-20T09:00:00.000Z', status: 'live', createdAt: now },
    { id: 'auction-table-1', productId: 'prod-bamboo-table', sellerId: 'seller-sari', title: 'Eco Friendly Bamboo Side Table', description: 'Small-batch bamboo side table with handwoven detailing.', images: ['/assets/product-thumb.png'], categoryId: 'furniture', startingPrice: 650000, currentBid: 850000, reservePrice: 800000, bidIncrement: 25000, bidCount: 5, featured: false, startTime: '2026-01-01T00:00:00.000Z', endTime: '2027-10-01T15:00:00.000Z', status: 'live', createdAt: now },
    { id: 'auction-vase-1', productId: 'prod-ceramic-vase', sellerId: 'seller-island', title: 'One-of-a-kind Ceramic Vase', description: 'Signed studio ceramic with a naturally varied glaze.', images: ['/assets/product-2.jpeg'], categoryId: 'home-decoration', startingPrice: 450000, currentBid: 450000, reservePrice: 600000, bidIncrement: 25000, bidCount: 0, featured: false, startTime: '2027-09-01T00:00:00.000Z', endTime: '2027-09-10T12:00:00.000Z', status: 'upcoming', createdAt: now },
    { id: 'auction-lamp-1', productId: 'prod-table-lamp', sellerId: 'seller-island', title: 'Artisan Mushroom Table Lamp', description: 'A warm sculptural lamp produced in a limited studio run.', images: ['/assets/product-1.jpeg'], categoryId: 'home-decoration', startingPrice: 900000, currentBid: 1250000, reservePrice: 1100000, bidIncrement: 50000, bidCount: 9, featured: true, startTime: '2026-01-01T00:00:00.000Z', endTime: '2027-08-12T10:00:00.000Z', status: 'live', createdAt: now },
    { id: 'auction-table-2', productId: 'prod-stone-table', sellerId: 'seller-sari', title: 'Stone Pedestal Side Table', description: 'Carved pedestal table with a softly finished stone top.', images: ['/assets/featured-2.png'], categoryId: 'furniture', startingPrice: 700000, currentBid: 925000, reservePrice: 900000, bidIncrement: 25000, bidCount: 6, featured: false, startTime: '2026-01-01T00:00:00.000Z', endTime: '2027-11-03T14:00:00.000Z', status: 'live', createdAt: now },
    { id: 'auction-sculpture-closed', productId: 'prod-ceramic-vase', sellerId: 'seller-island', title: 'Abstract Studio Sculpture', description: 'Completed collector auction.', images: ['/assets/product-3.jpeg'], categoryId: 'art', startingPrice: 500000, currentBid: 975000, reservePrice: 800000, bidIncrement: 25000, bidCount: 12, featured: false, startTime: '2026-06-01T00:00:00.000Z', endTime: '2026-07-01T00:00:00.000Z', status: 'completed', createdAt: now },
  ],
  auctionBids: [
    { id: 'bid-demo-1', auctionId: 'auction-chair-1', userId: 'demo-maya', amount: 900000, createdAt: '2026-08-01T10:00:00.000Z' },
    { id: 'bid-demo-2', auctionId: 'auction-chair-1', userId: 'demo-daniel', amount: 950000, createdAt: '2026-08-02T10:00:00.000Z' },
    { id: 'bid-demo-3', auctionId: 'auction-chair-1', userId: 'demo-maya', amount: 1000000, createdAt: '2026-08-03T10:00:00.000Z' },
  ],
  auctionWatchlists: [],
  affiliateProgram: { id: 'affiliate-default', title: 'Affiliate Program', description: 'Earn rewards. Create impact. Connect the world.', enabled: true, applicationsOpen: true },
  affiliateApplications: [],
  communityMessages: [
    { id: 'community-1', userId: 'demo-maya', userName: 'Maya', avatar: '/assets/avatar-2.png', text: 'Has anyone sourced hand-carved dining chairs recently?', createdAt: '2026-08-04T09:45:00.000Z' },
    { id: 'community-2', userId: 'demo-daniel', userName: 'Daniel', avatar: '/assets/avatar-1.png', text: 'The rattan collection is beautiful. I can share my supplier notes.', createdAt: '2026-08-04T09:50:00.000Z' },
  ],
  conversations: [],
  chatMessages: [],
  notifications: [],
  userPreferences: [],
  accounts: [],
  supportCategories: [
    { id: 'orders', name: 'Orders & Payments' },
    { id: 'shipping', name: 'Shipping & Delivery' },
    { id: 'products', name: 'Products & Sourcing' },
    { id: 'account', name: 'Account & Security' },
  ],
  supportFaqs: [
    { id: 'faq-order', question: 'How do I track my order?', answer: 'Open your order history to view the latest order and delivery updates.', categoryId: 'orders' },
    { id: 'faq-sourcing', question: 'How can Amia help with sourcing?', answer: 'Tell Amia what you need and she will help you refine your sourcing brief.', categoryId: 'products' },
    { id: 'faq-shipping', question: 'Where does Buyamia ship?', answer: 'Our marketplace supports international sourcing. Delivery options are confirmed with your supplier.', categoryId: 'shipping' },
  ],
  supportTickets: [],
  accountSecurity: [],
  shippingAddresses: [],
  bankAccounts: [],
  orders: [
    { id: 'order-demo-1001', userId: 'demo-user', orderNumber: 'BYA-1001', status: 'Shipped', trackingNumber: 'BYA-TRACK-1001', total: 1500000, subtotal: 1400000, taxes: 0, shippingCost: 100000, currency: 'IDR', invoiceReference: 'INV-BYA-1001', deliveryEstimate: '2026-08-18', seller: { name: 'Sari Living', id: 'seller-sari' }, shipping: { carrier: 'Buyamia Logistics', service: 'International Standard', destination: 'Bali, Indonesia' }, timeline: [{ status: 'Confirmed', at: now }, { status: 'Processing', at: now }, { status: 'Shipped', at: now }], payment: { method: 'Bank transfer', status: 'paid' }, createdAt: now, updatedAt: now, items: [{ productId: 'prod-bamboo-table', quantity: 1, unitPrice: 1400000 }] },
  ],
  wishlists: [],
  savedCollections: [],
  cartItems: [
    { id: 'cart-demo-1', userId: 'demo-user', productId: 'prod-bamboo-table', quantity: 1, packSize: 15, unitPrice: 1000000, shippingMethod: 'air', customization: 'Yes', warranty: 'No', createdAt: now },
    { id: 'cart-demo-2', userId: 'demo-user', productId: 'prod-bamboo-table', quantity: 1, packSize: 15, unitPrice: 1000000, shippingMethod: 'air', customization: 'Yes', warranty: 'No', createdAt: now },
    { id: 'cart-demo-3', userId: 'demo-user', productId: 'prod-bamboo-table', quantity: 1, packSize: 15, unitPrice: 1000000, shippingMethod: 'sea', customization: 'Yes · Custom size', warranty: 'No', createdAt: now },
  ],
  savedCartItems: [],
  cartCoupons: [],
  checkoutSessions: [],
  browsingHistory: [],
  affiliateProfiles: [],
  affiliateCommissions: [],
  affiliatePayouts: [],
  affiliateReferrals: [],
}

export function createStore(filePath) {
  let state
  let pendingWrite = Promise.resolve()

  async function load() {
    if (state) return state
    try {
      state = JSON.parse(await readFile(filePath, 'utf8'))
      for (const [collection, defaults] of Object.entries(seedData)) {
        if (state[collection] === undefined) state[collection] = structuredClone(defaults)
      }
      if (Array.isArray(state.auctions) && state.auctions.length === 0 && seedData.auctions.length) state.auctions = structuredClone(seedData.auctions)
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
      state = structuredClone(seedData)
    }
    return state
  }

  async function persist() {
    await mkdir(dirname(filePath), { recursive: true })
    const temporaryPath = `${filePath}.tmp`
    pendingWrite = pendingWrite.then(async () => {
      await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
      await rename(temporaryPath, filePath)
    })
    return pendingWrite
  }

  return {
    async read(collection) {
      const database = await load()
      return database[collection]
    },
    async getState() { return load() },
    async mutate(mutator) {
      const database = await load()
      const result = await mutator(database)
      await persist()
      return result
    },
    id(prefix) { return `${prefix}_${randomUUID()}` },
  }
}
