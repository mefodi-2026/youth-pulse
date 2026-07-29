import { categories, questions } from '../data/questions'
import type { CategoryId, Question, ResponseValue, Scores } from '../types'

const weight: Record<ResponseValue, number> = { A: 3, B: 2, C: 1, D: 0, SKIP: -1 }
export const scoreAnswers = (answers: Record<string, ResponseValue> = {}, questionSet: Question[] = questions): Scores => {
  const result = Object.fromEntries(Object.keys(categories).map(id => [id, 0])) as Record<CategoryId, number>
  for (const category of Object.keys(categories) as CategoryId[]) {
    const items = questionSet.filter(q => q.category === category)
    result[category] = items.length ? Math.round(items.reduce((sum, q) => sum + (answers[q.id] ? weight[answers[q.id]] : 0), 0) / (items.length * 3) * 100) : 0
  }
  return { categories: result, total: Math.round(Object.values(result).reduce((sum, value) => sum + value, 0) / Object.keys(categories).length) }
}

export const recommendation = (scores: Scores) => {
  const weakest = Object.entries(scores.categories).sort((a, b) => a[1] - b[1])[0][0] as CategoryId
  const copy: Record<CategoryId, string> = {
    communication: 'РќР° СЃР»РµРґСѓСЋС‰РµР№ РІСЃС‚СЂРµС‡Рµ РїРѕРїСЂРѕР±СѓР№ РїРµСЂРІС‹Рј РїРѕР·РґРѕСЂРѕРІР°С‚СЊСЃСЏ СЃ РѕРґРЅРёРј РЅРѕРІС‹Рј С‡РµР»РѕРІРµРєРѕРј.',
    forgiveness: 'Р•СЃР»Рё РµСЃС‚СЊ РЅРµРґРѕРїРѕРЅРёРјР°РЅРёРµ, РІС‹Р±РµСЂРё Р±РµСЂРµР¶РЅС‹Р№ СЂР°Р·РіРѕРІРѕСЂ РІРјРµСЃС‚Рѕ РјРѕР»С‡Р°РЅРёСЏ.',
    service: 'Р’С‹Р±РµСЂРё РѕРґРЅРѕ РЅРµР±РѕР»СЊС€РѕРµ РґРµР»Рѕ, РІ РєРѕС‚РѕСЂРѕРј СЃРјРѕР¶РµС€СЊ РїРѕРґРґРµСЂР¶Р°С‚СЊ РјРѕР»РѕРґС‘Р¶СЊ РЅР° СЌС‚РѕР№ РЅРµРґРµР»Рµ.',
    care: 'РћР±СЂР°С‚Рё РІРЅРёРјР°РЅРёРµ РЅР° С‚РѕРіРѕ, РєС‚Рѕ СЃРµРіРѕРґРЅСЏ РѕСЃС‚Р°С‘С‚СЃСЏ РѕРґРёРЅ, Рё РїСЂРѕСЃС‚Рѕ РїРѕР±СѓРґСЊ СЂСЏРґРѕРј.',
    honesty: 'Р’С‹Р±РµСЂРё РѕРґРёРЅ С‡РµСЃС‚РЅС‹Р№ Рё Р±РµСЂРµР¶РЅС‹Р№ С€Р°Рі, РєРѕС‚РѕСЂС‹Р№ РїРѕРјРѕР¶РµС‚ Р¶РёС‚СЊ РІ СЃРѕРіР»Р°СЃРёРё СЃРѕ СЃРІРѕРёРјРё РїСЂРёРЅС†РёРїР°РјРё.'
  }
  return copy[weakest]
}

