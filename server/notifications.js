export const NotificationType = Object.freeze({
  ORDER_CONFIRMED: 'ORDER_CONFIRMED',
  REFUND_REQUESTED: 'REFUND_REQUESTED',
  SUPPLIER_STATUS_CHANGED: 'SUPPLIER_STATUS_CHANGED',
  SUPPLIER_VERIFIED: 'SUPPLIER_VERIFIED',
  SUPPLIER_REJECTED: 'SUPPLIER_REJECTED',
  SUPPLIER_REVIEW_REQUIRED: 'SUPPLIER_REVIEW_REQUIRED',
  BUYING_POOL_JOINED: 'BUYING_POOL_JOINED',
  AUCTION_OUTBID: 'AUCTION_OUTBID',
})

export const NotificationChannel = Object.freeze({ IN_APP: 'IN_APP' })
export const NotificationStatus = Object.freeze({ DELIVERED: 'DELIVERED', SKIPPED: 'SKIPPED' })

const sensitiveKeys = /password|token|secret|cookie|authorization|card(number)?|cvv|cvc|securitycode|paymentcredential|apikey/i

function safePayload(value, depth = 0) {
  if (depth > 4 || value === undefined) return undefined
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) return value
  if (Array.isArray(value)) return value.slice(0, 30).map((item) => safePayload(item, depth + 1)).filter((item) => item !== undefined)
  if (typeof value !== 'object') return undefined
  return Object.fromEntries(Object.entries(value).filter(([key]) => !sensitiveKeys.test(key)).slice(0, 30).map(([key, entry]) => [key, safePayload(entry, depth + 1)]).filter(([, entry]) => entry !== undefined))
}

function content(type, payload) {
  const templates = {
    ORDER_CONFIRMED: { title: 'Order received', message: `Your order ${payload.orderNumber || ''} has been received.`, actionUrl: `/account/orders/${payload.orderId}` },
    REFUND_REQUESTED: { title: 'Refund request recorded', message: `A refund request was recorded for order ${payload.orderNumber || ''}.`, actionUrl: `/account/orders/${payload.orderId}` },
    SUPPLIER_STATUS_CHANGED: { title: 'Supplier status updated', message: `Your supplier status is now ${payload.status}.`, actionUrl: '/account/seller/status' },
    SUPPLIER_VERIFIED: { title: 'Supplier account verified', message: 'Your supplier account has been approved.', actionUrl: '/account/seller/dashboard' },
    SUPPLIER_REJECTED: { title: 'Supplier application update', message: 'Your supplier application was not approved.', actionUrl: '/account/seller/status' },
    SUPPLIER_REVIEW_REQUIRED: { title: 'Supplier review required', message: 'A supplier application is ready for administrative review.', actionUrl: '/admin' },
    BUYING_POOL_JOINED: { title: 'Buying Pool joined', message: `You joined ${payload.poolTitle || 'a Buying Pool'}.`, actionUrl: `/buying-pools/${payload.poolId}` },
    AUCTION_OUTBID: { title: 'You have been outbid', message: `Another bidder placed a higher bid on ${payload.auctionTitle || 'an auction'}.`, actionUrl: `/auctions/${payload.auctionId}` },
  }
  return templates[type]
}

export function createNotificationService(store, { ApiError, paginate }) {
  function publishInTransaction(db, event) {
    const template = content(event.type, event.payload || {})
    if (!template) throw new ApiError(500, 'NOTIFICATION_TYPE_UNSUPPORTED', 'Notification type is not supported')
    const recipientIds = [...new Set(event.recipientIds || [])].filter((recipientId) => typeof recipientId === 'string' && db.accounts.some((account) => account.userId === recipientId))
    const created = []
    for (const recipientId of recipientIds) {
      const preferences = db.userPreferences.find((item) => item.userId === recipientId)?.notifications
      if (event.critical !== true && preferences?.inApp === false) continue
      const timestamp = new Date().toISOString()
      const notification = { id: store.id('notification'), recipientId, userId: recipientId, type: event.type, title: template.title, message: template.message, payload: safePayload(event.payload || {}), priority: event.priority || 'NORMAL', actionUrl: template.actionUrl, channel: NotificationChannel.IN_APP, status: NotificationStatus.DELIVERED, readAt: null, createdAt: timestamp, deliveredAt: timestamp }
      db.notifications.push(notification)
      created.push(notification)
    }
    return created
  }

  async function publish(event) { return store.mutate((db) => publishInTransaction(db, event)) }
  async function list(query, user) {
    const rows = [...await store.read('notifications')].filter((item) => (item.recipientId || item.userId) === user.id).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    const result = paginate(rows, query)
    return { ...result, meta: { ...result.meta, unread: rows.filter((item) => !item.readAt).length } }
  }
  async function get(id, user) {
    const item = (await store.read('notifications')).find((notification) => notification.id === id && (notification.recipientId || notification.userId) === user.id)
    if (!item) throw new ApiError(404, 'NOTIFICATION_NOT_FOUND', 'Notification not found')
    return item
  }
  async function unreadCount(user) { return { count: (await store.read('notifications')).filter((item) => (item.recipientId || item.userId) === user.id && !item.readAt).length } }
  async function markRead(id, user) {
    return store.mutate((db) => { const item = db.notifications.find((notification) => notification.id === id && (notification.recipientId || notification.userId) === user.id); if (!item) throw new ApiError(404, 'NOTIFICATION_NOT_FOUND', 'Notification not found'); if (!item.readAt) item.readAt = new Date().toISOString(); return item })
  }
  async function markAllRead(user) {
    return store.mutate((db) => { const readAt = new Date().toISOString(); let updated = 0; for (const item of db.notifications) { if ((item.recipientId || item.userId) === user.id && !item.readAt) { item.readAt = readAt; updated += 1 } } return { updated, readAt } })
  }
  return { publish, publishInTransaction, list, get, unreadCount, markRead, markAllRead }
}
