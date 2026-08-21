import { AuditAction, AuditStatus } from './audit.js'
import { NotificationType } from './notifications.js'

function newestFirst(a, b) { return new Date(b.createdAt || b.updatedAt || 0) - new Date(a.createdAt || a.updatedAt || 0) }
function normalize(value) { return String(value || '').trim().toLowerCase() }

export function createAdminService(store, environment, { ApiError, text, paginate, audit, notificationService }) {
  const configuredAdmins = () => new Set(String(environment.BUYAMIA_ADMIN_EMAILS || '').split(',').map(normalize).filter(Boolean))

  async function requireAdmin(user) {
    if (!user?.authenticated) throw new ApiError(401, 'AUTHENTICATION_REQUIRED', 'Administrator authentication required')
    const account = (await store.read('accounts')).find((item) => item.userId === user.id)
    if (!account || (account.role !== 'administrator' && !configuredAdmins().has(normalize(account.email)))) {
      await store.mutate((db) => {
        db.securityEvents.push({ id: store.id('security'), type: 'unauthorized_admin_access', severity: 'high', userId: user.id, createdAt: new Date().toISOString() })
        audit.recordInTransaction(db, { actorId: user.id, actorRole: account?.role || user.role || 'unknown', action: AuditAction.PERMISSION_DENIED, resourceType: 'admin-api', resourceId: null, status: AuditStatus.DENIED, metadata: { requiredRole: 'administrator' } })
      })
      throw new ApiError(403, 'ADMIN_ACCESS_REQUIRED', 'Administrator access required')
    }
    return account
  }

  function record(db, admin, action, resourceType, resourceId, metadata = {}) {
    return audit.recordInTransaction(db, { actorId: admin.userId, actorRole: admin.role || 'administrator', actorEmail: admin.email, action, resourceType, resourceId, status: AuditStatus.SUCCESS, metadata })
  }

  function publicAccount(account, supplierIds) {
    return { userId: account.userId, name: [account.firstName, account.lastName].filter(Boolean).join(' ') || account.username, email: account.email, country: account.country, role: account.role === 'administrator' ? 'administrator' : supplierIds.has(account.userId) ? 'supplier' : 'user', status: account.status || 'active', createdAt: account.createdAt, updatedAt: account.updatedAt }
  }

  return {
    async dashboard(user) {
      const admin = await requireAdmin(user)
      const db = await store.getState()
      const activeAuctions = db.auctions.filter((item) => item.status === 'live' || (!item.status && new Date(item.endTime) > new Date())).length
      return {
        administrator: { userId: admin.userId, email: admin.email },
        metrics: {
          users: db.accounts.length,
          activeUsers: db.accounts.filter((item) => (item.status || 'active') === 'active').length,
          suppliers: db.sellerProfiles.length,
          pendingSuppliers: db.sellerApplications.filter((item) => item.status === 'submitted').length,
          activeMarketplaces: db.marketplaces.filter((item) => item.active).length,
          activeProducts: db.products.filter((item) => item.active).length,
          activeFlashSales: db.flashSales.filter((item) => !['draft', 'cancelled', 'expired'].includes(item.status)).length,
          activeAuctions,
          activeBuyingPools: db.buyingPools.filter((item) => item.status === 'open').length,
          pendingAffiliateApplications: db.affiliateApplications.filter((item) => item.status === 'pending').length,
          openSupportTickets: db.supportTickets.filter((item) => item.status === 'open').length,
          refundRequests: db.adminRefunds.length,
          securityAlerts: db.securityEvents.filter((item) => item.severity === 'high').length,
          amiaConversations: db.conversations.length,
        },
        recentActions: [...db.adminAuditLogs].sort(newestFirst).slice(0, 8),
        platform: {
          marketplaces: db.marketplaces.map((item) => ({ id: item.id, name: item.name, active: item.active })),
          flashSales: db.flashSales.slice(0, 8).map((item) => ({ id: item.id, title: item.title, status: item.status })),
          auctions: db.auctions.slice(0, 8).map((item) => ({ id: item.id, title: item.title, status: item.status })),
          buyingPools: db.buyingPools.slice(0, 8).map((item) => ({ id: item.id, title: item.title, status: item.status })),
          affiliateApplications: db.affiliateApplications.slice(-8).reverse().map((item) => ({ id: item.id, name: item.name, status: item.status })),
          supportTickets: db.supportTickets.slice(-8).reverse().map((item) => ({ id: item.id, title: item.title, status: item.status, priority: item.priority })),
        },
      }
    },

    async security(user) {
      await requireAdmin(user)
      const db = await store.getState()
      const sessionCount = db.accountSecurity.reduce((sum, item) => sum + (item.activeSessions || []).length, 0)
      return { summary: { activeSessions: sessionCount, failedLogins: db.securityEvents.filter((item) => item.type === 'failed_login').length, unauthorizedAdminRequests: db.securityEvents.filter((item) => item.type === 'unauthorized_admin_access').length, suspendedAccounts: db.accounts.filter((item) => item.status === 'suspended').length }, events: [...db.securityEvents].sort(newestFirst).slice(0, 100) }
    },

    async users(query, user) {
      await requireAdmin(user)
      const db = await store.getState(); const q = normalize(query.get('q')); const status = query.get('status'); const supplierIds = new Set(db.sellerProfiles.map((item) => item.userId).filter(Boolean))
      const rows = db.accounts.filter((item) => (!status || (item.status || 'active') === status) && (!q || normalize(`${item.firstName} ${item.lastName} ${item.email}`).includes(q))).map((item) => publicAccount(item, supplierIds)).sort(newestFirst)
      return paginate(rows, query)
    },

    async updateUser(id, body, user) {
      const admin = await requireAdmin(user); const status = text(body.status, 'status', { max: 20 }); const reason = text(body.reason, 'reason', { min: 5, max: 500 })
      if (!['active', 'suspended'].includes(status)) throw new ApiError(400, 'VALIDATION_ERROR', 'status must be active or suspended')
      if (id === admin.userId && status === 'suspended') throw new ApiError(409, 'SELF_SUSPENSION_NOT_ALLOWED', 'Administrators cannot suspend their own account')
      return store.mutate((db) => { const account = db.accounts.find((item) => item.userId === id); if (!account) throw new ApiError(404, 'USER_NOT_FOUND', 'User not found'); const previousStatus = account.status || 'active'; account.status = status; account.updatedAt = new Date().toISOString(); if (status === 'suspended') { const security = db.accountSecurity.find((item) => item.userId === id); if (security) security.activeSessions = [] }; record(db, admin, status === 'suspended' ? AuditAction.USER_SUSPENDED : AuditAction.USER_RESTORED, 'user', id, { reason, previousStatus, newStatus: status }); return { userId: account.userId, status: account.status } })
    },

    async suppliers(query, user) {
      await requireAdmin(user); const q = normalize(query.get('q')); const status = query.get('status'); const db = await store.getState()
      const profiles = db.sellerProfiles.map((item) => ({ ...item, recordType: 'profile' }))
      const profileUsers = new Set(db.sellerProfiles.map((item) => item.userId).filter(Boolean))
      const applications = db.sellerApplications.filter((item) => !profileUsers.has(item.userId)).map((item) => ({ id: item.id, userId: item.userId, companyName: item.companyName, displayName: item.brandName || item.companyName, contactName: item.legalName, email: item.email, phone: item.phone, country: item.country, categories: item.categories, verificationStatus: item.verificationStatus, public: false, recordType: 'application', createdAt: item.createdAt, updatedAt: item.updatedAt }))
      const rows = [...profiles, ...applications].filter((item) => (!status || item.verificationStatus === status) && (!q || normalize(`${item.companyName} ${item.displayName} ${item.email} ${item.country}`).includes(q))).sort(newestFirst)
      return paginate(rows, query)
    },

    async addSupplier(body, user) {
      const admin = await requireAdmin(user)
      const companyName = text(body.companyName, 'companyName', { min: 2, max: 160 }); const contactName = text(body.contactName, 'contactName', { min: 2, max: 120 }); const email = text(body.email, 'email', { max: 160 }).toLowerCase(); const phone = text(body.phone, 'phone', { max: 40 }); const country = text(body.country, 'country', { max: 100 }); const categoryId = text(body.categoryId, 'categoryId', { max: 120 }); const website = text(body.website, 'website', { max: 500, required: false }) || null; const verificationStatus = text(body.verificationStatus || 'pending-review', 'verificationStatus', { max: 30 })
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ApiError(400, 'VALIDATION_ERROR', 'email must be a valid email address')
      if (!/^\+?[0-9 ()-]{7,24}$/.test(phone)) throw new ApiError(400, 'VALIDATION_ERROR', 'phone must be a valid phone number')
      if (!['pending-review', 'approved'].includes(verificationStatus)) throw new ApiError(400, 'VALIDATION_ERROR', 'verificationStatus must be pending-review or approved')
      return store.mutate((db) => { if (!db.categories.some((item) => item.id === categoryId && item.active)) throw new ApiError(400, 'VALIDATION_ERROR', 'categoryId must identify an active category'); if (db.sellerProfiles.some((item) => normalize(item.email) === email)) throw new ApiError(409, 'SUPPLIER_EXISTS', 'A supplier with this email already exists'); const timestamp = new Date().toISOString(); const supplier = { id: store.id('seller'), userId: null, brandId: null, companyName, displayName: companyName, contactName, email, phone, country, location: country, categories: [categoryId], website, bio: '', verificationStatus, public: verificationStatus === 'approved', manuallyCreated: true, createdBy: admin.userId, createdAt: timestamp, updatedAt: timestamp }; db.sellerProfiles.push(supplier); record(db, admin, AuditAction.SUPPLIER_CREATED, 'supplier', supplier.id, { reason: text(body.reason || 'Manual supplier onboarding', 'reason', { min: 5, max: 500 }), newStatus: verificationStatus }); return supplier })
    },

    async updateSupplier(id, body, user) {
      const admin = await requireAdmin(user); const status = text(body.status, 'status', { max: 30 }); const reason = text(body.reason, 'reason', { min: 5, max: 500 })
      if (!['approved', 'rejected', 'suspended', 'pending-review'].includes(status)) throw new ApiError(400, 'VALIDATION_ERROR', 'Unsupported supplier status')
      return store.mutate((db) => {
        const timestamp = new Date().toISOString(); const supplier = db.sellerProfiles.find((item) => item.id === id)
        if (supplier) { const previousStatus = supplier.verificationStatus; supplier.verificationStatus = status; supplier.public = status === 'approved'; supplier.updatedAt = timestamp; const action = status === 'approved' ? AuditAction.SUPPLIER_VERIFIED : status === 'rejected' ? AuditAction.SUPPLIER_REJECTED : AuditAction.SUPPLIER_STATUS_CHANGED; record(db, admin, action, 'supplier', id, { reason, previousStatus, newStatus: status, public: supplier.public }); if (supplier.userId) notificationService.publishInTransaction(db, { recipientIds: [supplier.userId], type: status === 'approved' ? NotificationType.SUPPLIER_VERIFIED : status === 'rejected' ? NotificationType.SUPPLIER_REJECTED : NotificationType.SUPPLIER_STATUS_CHANGED, payload: { supplierId: supplier.id, status } }); return { ...supplier, recordType: 'profile' } }
        const application = db.sellerApplications.find((item) => item.id === id)
        if (!application) throw new ApiError(404, 'SUPPLIER_NOT_FOUND', 'Supplier or supplier application not found')
        if (!['approved', 'rejected', 'pending-review'].includes(status)) throw new ApiError(400, 'VALIDATION_ERROR', 'Supplier applications cannot be suspended before approval')
        if (['approved', 'rejected'].includes(status) && application.status !== 'submitted') throw new ApiError(409, 'SUPPLIER_APPLICATION_NOT_READY', 'Only submitted supplier applications can be approved or rejected')
        const previousState = { status: application.status, verificationStatus: application.verificationStatus }
        application.status = status === 'approved' ? 'approved' : status === 'rejected' ? 'rejected' : 'submitted'
        application.verificationStatus = status
        application.reviewedAt = timestamp; application.reviewedBy = admin.userId; application.reviewReason = reason; application.updatedAt = timestamp
        let profile = db.sellerProfiles.find((item) => item.userId === application.userId)
        if (status === 'approved' && !profile) { profile = { id: store.id('seller'), userId: application.userId, brandId: null, companyName: application.companyName, displayName: application.brandName || application.companyName, contactName: application.legalName, email: application.email, phone: application.phone, country: application.country, location: application.country, categories: application.categories, website: null, bio: '', verificationStatus: 'approved', public: true, createdAt: timestamp, updatedAt: timestamp }; db.sellerProfiles.push(profile) }
        const action = status === 'approved' ? AuditAction.SUPPLIER_VERIFIED : status === 'rejected' ? AuditAction.SUPPLIER_REJECTED : AuditAction.SUPPLIER_STATUS_CHANGED
        record(db, admin, action, 'seller-application', id, { reason, previousStatus: previousState.verificationStatus, newStatus: application.verificationStatus, supplierId: profile?.id || null })
        notificationService.publishInTransaction(db, { recipientIds: [application.userId], type: status === 'approved' ? NotificationType.SUPPLIER_VERIFIED : status === 'rejected' ? NotificationType.SUPPLIER_REJECTED : NotificationType.SUPPLIER_STATUS_CHANGED, payload: { applicationId: application.id, supplierId: profile?.id || null, status } })
        return profile ? { ...profile, recordType: 'profile' } : { ...application, displayName: application.brandName || application.companyName, recordType: 'application' }
      })
    },

    async refunds(query, user) {
      await requireAdmin(user); const db = await store.getState(); const q = normalize(query.get('q'))
      const orders = db.orders.filter((item) => !q || normalize(`${item.id} ${item.orderNumber}`).includes(q)).map((order) => { const requested = db.adminRefunds.filter((item) => item.orderId === order.id && item.status !== 'rejected').reduce((sum, item) => sum + item.amount, 0); return { id: order.id, orderNumber: order.orderNumber, userId: order.userId, total: order.total, currency: order.currency, payment: order.payment, refundableAmount: Math.max(0, order.total - requested), refundRequests: db.adminRefunds.filter((item) => item.orderId === order.id) } })
      return { orders, refunds: [...db.adminRefunds].sort(newestFirst), provider: { configured: false, status: 'payment_provider_not_configured' } }
    },

    async createRefund(body, user) {
      const admin = await requireAdmin(user); const orderId = text(body.orderId, 'orderId', { max: 160 }); const reason = text(body.reason, 'reason', { min: 10, max: 1000 }); const amount = Number(body.amount)
      if (body.confirmed !== true) throw new ApiError(400, 'CONFIRMATION_REQUIRED', 'Refund confirmation is required')
      if (!Number.isSafeInteger(amount) || amount < 1) throw new ApiError(400, 'VALIDATION_ERROR', 'amount must be a positive whole number')
      return store.mutate((db) => { const order = db.orders.find((item) => item.id === orderId); if (!order) throw new ApiError(404, 'ORDER_NOT_FOUND', 'Order not found'); if (!['paid', 'completed'].includes(order.payment?.status)) throw new ApiError(409, 'ORDER_NOT_REFUNDABLE', 'The order payment is not eligible for a refund'); const alreadyRequested = db.adminRefunds.filter((item) => item.orderId === orderId && item.status !== 'rejected').reduce((sum, item) => sum + item.amount, 0); const eligible = order.total - alreadyRequested; if (amount > eligible) throw new ApiError(409, 'REFUND_AMOUNT_EXCEEDED', `Refund amount cannot exceed ${eligible}`); const timestamp = new Date().toISOString(); const refund = { id: store.id('refund'), orderId, orderNumber: order.orderNumber, amount, currency: order.currency || 'IDR', reason, administratorId: admin.userId, status: 'payment_provider_not_configured', providerExecuted: false, createdAt: timestamp, updatedAt: timestamp }; db.adminRefunds.push(refund); record(db, admin, AuditAction.REFUND_CREATED, 'refund', refund.id, { reason, orderId, amount, currency: refund.currency, newStatus: refund.status }); notificationService.publishInTransaction(db, { recipientIds: [order.userId], type: NotificationType.REFUND_REQUESTED, payload: { refundId: refund.id, orderId: order.id, orderNumber: order.orderNumber } }); return refund })
    },

    async amia(user) {
      await requireAdmin(user); const db = await store.getState(); const settings = db.adminSettings.amia
      return { status: settings.enabled ? 'active' : 'disabled', settings, usage: { conversations: db.conversations.length, messages: db.chatMessages.length, assistantMessages: db.chatMessages.filter((item) => item.role === 'assistant').length }, provider: { configured: Boolean(environment.OPENAI_API_KEY), secretExposed: false }, recentErrors: db.securityEvents.filter((item) => item.source === 'amia').sort(newestFirst).slice(0, 20) }
    },

    async updateAmia(body, user) {
      const admin = await requireAdmin(user); if (typeof body.enabled !== 'boolean') throw new ApiError(400, 'VALIDATION_ERROR', 'enabled must be a boolean'); const moderation = text(body.moderation, 'moderation', { max: 20 }); if (!['standard', 'strict'].includes(moderation)) throw new ApiError(400, 'VALIDATION_ERROR', 'moderation must be standard or strict'); const allowed = new Set(['products', 'suppliers', 'services', 'categories', 'auctions', 'flash-sales']); if (!Array.isArray(body.capabilities) || body.capabilities.some((item) => !allowed.has(item))) throw new ApiError(400, 'VALIDATION_ERROR', 'capabilities contains an unsupported value')
      return store.mutate((db) => { const previousState = structuredClone(db.adminSettings.amia); db.adminSettings.amia = { enabled: body.enabled, moderation, capabilities: [...new Set(body.capabilities)], updatedAt: new Date().toISOString(), updatedBy: admin.userId }; record(db, admin, AuditAction.ADMIN_CONFIGURATION_UPDATED, 'amia', 'global', { reason: text(body.reason, 'reason', { min: 5, max: 500 }), previousState: { enabled: previousState.enabled, moderation: previousState.moderation, capabilities: previousState.capabilities }, newState: { enabled: body.enabled, moderation, capabilities: db.adminSettings.amia.capabilities } }); return db.adminSettings.amia })
    },

    async auditLog(query, user) {
      await requireAdmin(user)
      const action = text(query.get('action'), 'action', { max: 100, required: false })
      const actorId = text(query.get('actorId'), 'actorId', { max: 160, required: false })
      const resourceType = text(query.get('resourceType'), 'resourceType', { max: 100, required: false })
      const resourceId = text(query.get('resourceId'), 'resourceId', { max: 160, required: false })
      const status = text(query.get('status'), 'status', { max: 20, required: false })
      if (status && !Object.values(AuditStatus).includes(status)) throw new ApiError(400, 'VALIDATION_ERROR', 'status must be SUCCESS, DENIED, or FAILED')
      const from = query.get('from'); const to = query.get('to')
      if (from && Number.isNaN(Date.parse(from))) throw new ApiError(400, 'VALIDATION_ERROR', 'from must be a valid date')
      if (to && Number.isNaN(Date.parse(to))) throw new ApiError(400, 'VALIDATION_ERROR', 'to must be a valid date')
      const rows = [...await store.read('adminAuditLogs')].filter((item) => (!action || item.action === action) && (!actorId || (item.actorId || item.administratorId) === actorId) && (!resourceType || (item.resourceType || item.targetType) === resourceType) && (!resourceId || (item.resourceId || item.targetId) === resourceId) && (!status || (item.status || String(item.result).toUpperCase()) === status) && (!from || new Date(item.createdAt) >= new Date(from)) && (!to || new Date(item.createdAt) <= new Date(to))).sort(newestFirst)
      return paginate(rows, query)
    },
  }
}
