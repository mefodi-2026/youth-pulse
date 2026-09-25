import type { VerseDifficulty, VerseDifficultySelection, VersePack, VersePackValidation } from './types'

const normalized = (value: string) => value.toLocaleLowerCase('ru-RU').replace(/[«»„“”.,!?;:—–\-()\s]+/g, ' ').trim()

export const validateVersePack = (pack: VersePack): VersePackValidation => {
  const issues: VersePackValidation['issues'] = []
  if (!pack.title.trim()) issues.push({ path: 'title', message: 'Укажите название набора.' })
  const ids = new Set<string>(); const texts = new Set<string>()
  pack.entries.forEach((entry, index) => {
    const path = `entries.${index}`
    if (!entry.id.trim()) issues.push({ path, message: 'У стиха нет уникального ID.' })
    if (ids.has(entry.id)) issues.push({ path, message: `Повторяется ID ${entry.id}.` }); ids.add(entry.id)
    if (!entry.reference.trim() || !entry.fullText.trim() || !entry.start.trim() || !entry.end.trim()) issues.push({ path, message: 'Заполните ссылку, полный текст и оба фрагмента.' })
    if (normalized(entry.start) === normalized(entry.end)) issues.push({ path, message: 'Начало и окончание не должны совпадать.' })
    const text = normalized(entry.fullText)
    if (entry.enabled && entry.verificationStatus === 'verified' && text && texts.has(text)) issues.push({ path, message: 'Повторяется полный текст игрового стиха.' }); if (entry.enabled && entry.verificationStatus === 'verified' && text) texts.add(text)
    if (entry.verificationStatus === 'verified' && (!normalized(entry.fullText).includes(normalized(entry.start)) || !normalized(entry.fullText).includes(normalized(entry.end)))) issues.push({ path, message: 'Фрагменты должны дословно входить в полный текст.' })
  })
  return { valid: issues.length === 0, issues }
}

export const difficultyLevels = (difficulty: VerseDifficultySelection, mix: VerseDifficulty[] = []): VerseDifficulty[] => difficulty === 'all' ? ['easy', 'medium', 'hard'] : difficulty === 'mixed' ? [...new Set(mix)] : [difficulty]
export const countAvailableVerses = (pack: VersePack, difficulty: VerseDifficultySelection, mix: VerseDifficulty[] = []) => {
  const levels = difficultyLevels(difficulty, mix)
  return pack.entries.filter(entry => entry.enabled && entry.verificationStatus === 'verified' && levels.includes(entry.difficulty)).length
}
