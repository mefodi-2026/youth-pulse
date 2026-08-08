import type { LeaderProfile, ProductConfig, ProductId, Workspace, WorkspaceProduct } from '../types'

export type ProductFeature = 'create_room'

export interface ProductAccessInput {
  profile: Pick<LeaderProfile, 'status'> | null | undefined
  workspace: Workspace | null | undefined
  workspaceProduct: WorkspaceProduct | null | undefined
  product: ProductConfig | null | undefined
  now?: number
}

export interface AccessDecision { allowed: boolean; reason?: string }

const allowedBillingStatuses = new Set(['free', 'pilot', 'manual_paid'])

/**
 * One policy entry point for product access. UI buttons use this for feedback,
 * while Firebase Rules repeat the create-room condition as the protected gate.
 */
export const canUseProduct = (_productId: ProductId, input: ProductAccessInput): AccessDecision => {
  const now = input.now ?? Date.now()
  if (input.profile?.status !== 'active') return { allowed: false, reason: 'Аккаунт ведущего не активен.' }
  if (!input.workspace) return { allowed: false, reason: 'Рабочее пространство не найдено.' }

  const billingStatus = input.workspace.billingStatus
  const legacyWorkspace = !billingStatus && !input.workspaceProduct
  if (!legacyWorkspace && (!billingStatus || !allowedBillingStatuses.has(billingStatus))) {
    return { allowed: false, reason: 'Доступ рабочего пространства сейчас не активен.' }
  }
  if (input.workspace.accessEndsAt && input.workspace.accessEndsAt > 0 && input.workspace.accessEndsAt <= now) {
    return { allowed: false, reason: 'Срок доступа рабочего пространства завершён.' }
  }

  if (!legacyWorkspace) {
    if (!input.workspaceProduct?.enabled) return { allowed: false, reason: 'Этот продукт не подключён для рабочего пространства.' }
    if (input.workspaceProduct.planId !== input.workspace.planId) return { allowed: false, reason: 'Данные доступа продукта требуют проверки.' }
    if (input.workspaceProduct.expiresAt > 0 && input.workspaceProduct.expiresAt <= now) {
      return { allowed: false, reason: 'Срок доступа к продукту завершён.' }
    }
  }

  // A missing record means the existing free MVP is still allowed. Once a
  // product record is created, its operational status becomes authoritative.
  const status = input.product?.status ?? 'enabled'
  if (status === 'disabled' || status === 'maintenance') return { allowed: false, reason: 'Создание новых комнат временно недоступно.' }
  if (status === 'testing' && !input.workspaceProduct?.testing) return { allowed: false, reason: 'Продукт доступен только для тестовых рабочих пространств.' }
  return { allowed: true }
}

export const canUseFeature = (productId: ProductId, feature: ProductFeature, input: ProductAccessInput): AccessDecision => {
  if (feature === 'create_room') return canUseProduct(productId, input)
  return { allowed: false, reason: 'Функция недоступна.' }
}
