import { useMemo, useState } from 'react'
import { platformProductDefaults, saveProductAsOwner, saveWorkspaceProductAsOwner } from './repositories/firebaseRepository'
import type { ProductConfig, ProductStatus, Workspace, WorkspaceProduct } from './types'

type ProductMap = Record<string, ProductConfig>
type WorkspaceProductMap = Record<string, Record<string, WorkspaceProduct>>

const statusLabels: Record<ProductStatus, string> = {
  enabled: 'Доступен',
  maintenance: 'Техработы',
  testing: 'Тестирование',
  disabled: 'Отключён',
}

interface OwnerProductsProps {
  products: ProductMap
  workspaces: Record<string, Workspace>
  workspaceProducts: WorkspaceProductMap
  saving: boolean
  onSaving: (value: boolean) => void
  onError: (message: string) => void
}

export function OwnerProducts({ products, workspaces, workspaceProducts, saving, onSaving, onError }: OwnerProductsProps) {
  const [editingId, setEditingId] = useState('')
  const [draft, setDraft] = useState<ProductConfig | null>(null)
  const [accessDrafts, setAccessDrafts] = useState<Record<string, { enabled: boolean; testing: boolean; planId: string; expiresAt: number }>>({})

  const catalog = useMemo(() => {
    const ids = new Set([...Object.keys(platformProductDefaults), ...Object.keys(products)])
    return [...ids].map(id => ({ ...platformProductDefaults[id], ...products[id], productId: id })).sort((a, b) => a.name.localeCompare(b.name, 'ru'))
  }, [products])

  const openEditor = (product: ProductConfig) => {
    setEditingId(product.productId)
    setDraft({ ...product })
    setAccessDrafts(Object.fromEntries(Object.values(workspaces).map(workspace => {
      const access = workspaceProducts[workspace.id]?.[product.productId]
      return [workspace.id, {
        enabled: access?.enabled ?? true,
        testing: access?.testing ?? false,
        planId: access?.planId || workspace.planId || 'pilot-free',
        expiresAt: access?.expiresAt || 0,
      }]
    })))
  }

  const save = async () => {
    if (!draft) return
    onSaving(true); onError('')
    try {
      await saveProductAsOwner(draft)
      await Promise.all(Object.entries(accessDrafts).map(([workspaceId, access]) => saveWorkspaceProductAsOwner(workspaceId, draft.productId, access)))
      setEditingId(''); setDraft(null)
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Не удалось сохранить настройки продукта.')
    } finally { onSaving(false) }
  }

  return <>
    <header className="owner-header"><div><p className="eyebrow">ГЛОБАЛЬНАЯ ДОСТУПНОСТЬ</p><h1>Продукты</h1></div></header>
    <section className="owner-products-note glass"><h2>Управление запуском, а не деплоем</h2><p>Настройки здесь публикуются в Firebase только после кнопки «Сохранить и опубликовать». Черновик остаётся в форме владельца. Разработка кода по-прежнему проверяется в Preview-версии, а затем отдельно публикуется в Production.</p></section>
    <div className="owner-product-list">
      {catalog.map(product => <section className="glass owner-product-card" key={product.productId}>
        <div><p className={`owner-status product-${product.status}`}>{statusLabels[product.status]}</p><h2>{product.name}</h2><p>{product.description}</p><small>Тип: {product.type} · опубликованная версия: v{product.version || 1}</small></div>
        <button type="button" className="button owner-button secondary" onClick={() => openEditor(product)}>Настроить</button>
      </section>)}
    </div>
    {draft && <section className="glass product-editor">
      <div className="product-editor-head"><div><p className="eyebrow">ЧЕРНОВИК НАСТРОЕК</p><h2>{draft.name || 'Продукт'}</h2></div><button type="button" className="button owner-button secondary" onClick={() => { setEditingId(''); setDraft(null) }}>Закрыть</button></div>
      <div className="product-fields">
        <label>Название<input value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} /></label>
        <label>Тип<select value={draft.type} onChange={event => setDraft({ ...draft, type: event.target.value as ProductConfig['type'] })}><option value="diagnostic">Диагностика</option><option value="quiz">Викторина</option><option value="game">Игра</option></select></label>
        <label>Статус<select value={draft.status} onChange={event => setDraft({ ...draft, status: event.target.value as ProductStatus })}><option value="enabled">enabled — доступен</option><option value="maintenance">maintenance — техработы</option><option value="testing">testing — только owner и тестовые workspace</option><option value="disabled">disabled — без новых запусков</option></select></label>
        <label className="product-field-wide">Описание<textarea value={draft.description} onChange={event => setDraft({ ...draft, description: event.target.value })} /></label>
        <label className="product-field-wide">Сообщение для лидера при недоступности<textarea placeholder="Например: Диагностика обновляется, вернитесь позже." value={draft.maintenanceMessage || ''} onChange={event => setDraft({ ...draft, maintenanceMessage: event.target.value })} /></label>
      </div>
      <div className="product-access-head"><div><p className="eyebrow">ДОСТУП WORKSPACE</p><p>В режиме <code>testing</code> продукт получают только отмеченные тестовые workspace и владелец платформы.</p></div></div>
      <div className="product-access-list">{Object.values(workspaces).map(workspace => {
        const access = accessDrafts[workspace.id]
        if (!access) return null
        return <div key={workspace.id} className="product-access-row"><div><b>{workspace.name}</b><small>{workspace.city} · {workspace.id}</small></div><label><input type="checkbox" checked={access.enabled} onChange={event => setAccessDrafts({ ...accessDrafts, [workspace.id]: { ...access, enabled: event.target.checked } })} /> Включён</label><label><input type="checkbox" checked={access.testing} onChange={event => setAccessDrafts({ ...accessDrafts, [workspace.id]: { ...access, testing: event.target.checked } })} /> Тестовый</label></div>
      })}</div>
      <div className="owner-actions"><button type="button" className="button owner-button" disabled={saving} onClick={() => void save()}>{saving ? 'Сохраняем…' : 'Сохранить и опубликовать'}</button><button type="button" className="button owner-button secondary" onClick={() => { setEditingId(''); setDraft(null) }}>Отменить</button></div>
      {editingId && <p className="owner-help">Изменение статуса не удаляет вопросы, комнаты, ответы, отчёты или архивы. Уже запущенные комнаты продолжают работу; ограничение действует только на новые комнаты.</p>}
    </section>}
  </>
}
