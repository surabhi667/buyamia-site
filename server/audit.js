export const AuditAction = Object.freeze({
  LOGIN_SUCCESS: 'LOGIN_SUCCESS',
  LOGIN_FAILED: 'LOGIN_FAILED',
  PERMISSION_DENIED: 'PERMISSION_DENIED',
  USER_SUSPENDED: 'USER_SUSPENDED',
  USER_RESTORED: 'USER_RESTORED',
  SUPPLIER_CREATED: 'SUPPLIER_CREATED',
  SUPPLIER_STATUS_CHANGED: 'SUPPLIER_STATUS_CHANGED',
  SUPPLIER_VERIFIED: 'SUPPLIER_VERIFIED',
  SUPPLIER_REJECTED: 'SUPPLIER_REJECTED',
  REFUND_CREATED: 'REFUND_CREATED',
  ADMIN_CONFIGURATION_UPDATED: 'ADMIN_CONFIGURATION_UPDATED',
})

export const AuditStatus = Object.freeze({ SUCCESS: 'SUCCESS', DENIED: 'DENIED', FAILED: 'FAILED' })

const sensitiveKeys = /password|token|secret|cookie|authorization|card(number)?|cvv|cvc|securitycode|paymentcredential|apikey/i

function safeMetadata(value, depth = 0) {
  if (depth > 5 || value === undefined) return undefined
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) return value
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => safeMetadata(item, depth + 1)).filter((item) => item !== undefined)
  if (typeof value !== 'object') return undefined
  return Object.fromEntries(Object.entries(value).filter(([key]) => !sensitiveKeys.test(key)).slice(0, 50).map(([key, entry]) => [key, safeMetadata(entry, depth + 1)]).filter(([, entry]) => entry !== undefined))
}

export function createAuditService(store) {
  function build(input) {
    const createdAt = new Date().toISOString()
    return {
      id: store.id('audit'),
      actorId: input.actorId || null,
      actorRole: input.actorRole || null,
      action: input.action,
      resourceType: input.resourceType || null,
      resourceId: input.resourceId || null,
      status: input.status || AuditStatus.SUCCESS,
      metadata: safeMetadata(input.metadata || {}),
      createdAt,
      // Compatibility aliases for the existing read-only Admin UI.
      administratorId: input.actorId || null,
      administratorEmail: input.actorEmail || null,
      targetType: input.resourceType || null,
      targetId: input.resourceId || null,
      result: (input.status || AuditStatus.SUCCESS).toLowerCase(),
      reason: typeof input.metadata?.reason === 'string' ? input.metadata.reason : undefined,
    }
  }

  function recordInTransaction(db, input) {
    const event = build(input)
    db.adminAuditLogs.push(event)
    return event
  }

  async function record(input) {
    return store.mutate((db) => recordInTransaction(db, input))
  }

  return { record, recordInTransaction }
}
