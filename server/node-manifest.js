const manifestVersion = '1.0.0'
const nodeKinds = new Set(['supplier', 'business'])

function timestamp(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
}

function latestTimestamp(values) {
  return values.filter(timestamp).sort((a, b) => Date.parse(b) - Date.parse(a))[0]
}

function compact(value) {
  if (Array.isArray(value)) return value.map(compact)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined).map(([key, item]) => [key, compact(item)]))
}

export function validateNodeManifest(node) {
  const errors = []
  if (!node || typeof node !== 'object') return { valid: false, errors: [{ path: '$', code: 'TYPE', message: 'Manifest must be an object' }] }
  if (!node.manifest || typeof node.manifest !== 'object') errors.push({ path: 'manifest', code: 'REQUIRED', message: 'manifest is required' })
  if (!node.manifest?.schema || !/^com\.buyamia\.node\/\d+\.\d+\.\d+$/.test(node.manifest.schema)) errors.push({ path: 'manifest.schema', code: 'FORMAT', message: 'manifest.schema must identify a versioned com.buyamia.node schema' })
  if (!node.manifest?.version || !/^\d+\.\d+\.\d+$/.test(node.manifest.version)) errors.push({ path: 'manifest.version', code: 'FORMAT', message: 'manifest.version must use semantic versioning' })
  if (!node.manifest?.node_id || typeof node.manifest.node_id !== 'string') errors.push({ path: 'manifest.node_id', code: 'REQUIRED', message: 'manifest.node_id must be a stable string' })
  if (!nodeKinds.has(node.manifest?.kind)) errors.push({ path: 'manifest.kind', code: 'ENUM', message: 'manifest.kind must be supplier or business' })
  if (!timestamp(node.manifest?.updated_at)) errors.push({ path: 'manifest.updated_at', code: 'FORMAT', message: 'manifest.updated_at must be a valid timestamp' })
  if (!node.agent_context?.agent_context?.trim()) errors.push({ path: 'agent_context.agent_context', code: 'REQUIRED', message: 'agent context must not be empty' })
  if (!Array.isArray(node.agent_context?.not_a_fit) || node.agent_context.not_a_fit.length === 0 || node.agent_context.not_a_fit.some((item) => typeof item !== 'string' || !item.trim())) errors.push({ path: 'agent_context.not_a_fit', code: 'MIN_ITEMS', message: 'not_a_fit must contain at least one real constraint' })
  if (!Array.isArray(node.offerings)) errors.push({ path: 'offerings', code: 'TYPE', message: 'offerings must be an array' })
  else node.offerings.forEach((offering, index) => {
    if (!['product', 'service'].includes(offering?.kind)) errors.push({ path: `offerings[${index}].kind`, code: 'ENUM', message: 'offering kind must be product or service' })
    if (!offering?.id || !offering?.agent_label || !offering?.unit) errors.push({ path: `offerings[${index}]`, code: 'REQUIRED', message: 'offering id, agent_label, and unit are required' })
    if (offering?.price_band && (!Number.isFinite(offering.price_band.minimum) || !Number.isFinite(offering.price_band.maximum) || offering.price_band.minimum > offering.price_band.maximum || !offering.price_band.currency)) errors.push({ path: `offerings[${index}].price_band`, code: 'FORMAT', message: 'price_band must contain a valid currency range' })
  })
  if (!node.capabilities || typeof node.capabilities !== 'object' || Array.isArray(node.capabilities)) errors.push({ path: 'capabilities', code: 'TYPE', message: 'capabilities must be an object' })
  if (typeof node.capabilities?.pools?.joinable !== 'boolean' || typeof node.capabilities?.pools?.hostable !== 'boolean') errors.push({ path: 'capabilities.pools', code: 'REQUIRED', message: 'pool joinable and hostable support must be explicit booleans' })
  return { valid: errors.length === 0, errors }
}

export function buildNodeManifest({ supplier, brand, products, pools, participants }) {
  const supplierProducts = products.filter((product) => product.active && brand?.productIds?.includes(product.id)).sort((a, b) => a.id.localeCompare(b.id))
  const hostedPools = pools.filter((pool) => pool.supplierId === supplier.id).sort((a, b) => a.id.localeCompare(b.id))
  const poolIds = new Set(hostedPools.map((pool) => pool.id))
  const updatedAt = latestTimestamp([supplier.updatedAt, supplier.createdAt, brand?.updatedAt, brand?.createdAt, ...supplierProducts.flatMap((item) => [item.updatedAt, item.createdAt]), ...hostedPools.flatMap((item) => [item.updatedAt, item.createdAt])])
  const minimumMoq = supplierProducts.length ? Math.min(...supplierProducts.map((item) => item.minimumOrder || 1)) : null
  const categories = [...new Set(supplier.categories || supplierProducts.map((item) => item.categoryId))].sort()
  const draft = compact({
    manifest: {
      schema: `com.buyamia.node/${manifestVersion}`,
      version: manifestVersion,
      node_id: `buyamia:supplier:${supplier.id}`,
      kind: 'supplier',
      subkind: 'merchant',
      updated_at: updatedAt,
    },
    identity: {
      business_name: supplier.displayName || supplier.companyName,
      home_url: `/sellers/${encodeURIComponent(supplier.id)}`,
      service_area: [supplier.location || supplier.country].filter(Boolean),
    },
    agent_context: {
      agent_context: supplier.bio,
      offers_summary: categories.length ? `Products in ${categories.join(', ')}.` : 'No active catalog is currently published.',
      ideal_requests: categories.map((category) => `Procurement requests for ${category.replaceAll('-', ' ')}`),
      not_a_fit: [
        ...(minimumMoq ? [`Orders below the published minimum order quantity of ${minimumMoq} units`] : ['Orders requiring an unpublished minimum order quantity']),
        'Requests requiring guaranteed lead times that have not been published',
        'Requests outside the published product categories',
      ],
      tone: 'factual',
    },
    platform_attested: {
      lifecycle_stage: supplier.public ? 'active' : 'inactive',
      verification_tier: supplier.verificationStatus,
      badges: supplier.verificationStatus === 'approved' ? ['verified_supplier'] : [],
      signature: { status: 'not_signed', algorithm: null, value: null },
    },
    offerings: supplierProducts.map((product) => ({
      id: product.id,
      kind: 'product',
      unit: 'item',
      price_band: { minimum: product.price, maximum: product.price, currency: product.currency },
      moq: product.minimumOrder || 1,
      agent_label: product.title,
      constraints: [
        ...(product.stock === 0 ? ['out_of_stock'] : []),
        ...(!product.customization ? ['customization_not_available'] : []),
        ...(!product.warranty ? ['warranty_not_published'] : []),
      ],
      product_url: `/products/${encodeURIComponent(product.id)}`,
    })),
    capabilities: {
      ucp: { profile_url: '/.well-known/ucp', status: 'not_published' },
      supported_extensions: [],
      'com.buyamia.pool_seat': { supported: false },
      rfq: { supported: supplierProducts.length > 0, endpoint_template: supplierProducts.length > 0 ? '/api/products/{product_id}/quotes' : undefined },
      pools: { joinable: false, hostable: hostedPools.length > 0, supported_types: hostedPools.length > 0 ? ['direct'] : [] },
      live_sessions: { supported: false },
      scheduling: { supported: false },
      escrow: { supported: false },
    },
    policies: {},
    pool_participation: {
      hosted_pools: hostedPools.map((pool) => ({ id: pool.id, status: pool.status, product_id: pool.productId, minimum_quantity: pool.minimumQuantity, target_businesses: pool.targetBusinesses, href: `/api/buying-pools/${encodeURIComponent(pool.id)}` })),
      joined_pools: [],
      standing_commitments: [],
      capacity_attestation: { status: 'not_available' },
      recorded_participants: participants.filter((item) => poolIds.has(item.poolId)).length,
    },
    receipts_and_covenant: {
      supported: false,
    },
    provenance: {
      self_reported: ['identity', 'agent_context', 'offerings', 'policies'],
      platform_attested: ['platform_attested.verification_tier', 'platform_attested.badges', 'pool_participation.hosted_pools'],
    },
  })
  const validation = validateNodeManifest(draft)
  return { ...draft, conformance: { status: validation.valid ? 'conformant' : 'unverified_manifest', errors: validation.errors } }
}

