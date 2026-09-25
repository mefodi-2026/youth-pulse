const levels = ['easy', 'medium', 'hard']
const selections = ['easy', 'medium', 'hard', 'mixed', 'all']

const defaultUnlocks = () => ({ easy: true, medium: false, hard: false, mixed: false, all: false })

const normalizeProgress = (value, bookId) => ({
  bookId,
  unlocked: { ...defaultUnlocks(), ...(value?.unlocked || {}), easy: true },
  completedRoomIds: value?.completedRoomIds && typeof value.completedRoomIds === 'object' ? value.completedRoomIds : {},
  updatedAt: Number(value?.updatedAt || 0),
})

const isDifficultyUnlocked = (progress, difficulty) => difficulty === 'easy' || Boolean(progress?.unlocked?.[difficulty])

const difficultyLevels = config => {
  if (levels.includes(config?.difficulty)) return [config.difficulty]
  if (config?.difficulty === 'all') return [...levels]
  if (config?.difficulty === 'mixed') {
    const selected = [...new Set(Array.isArray(config.difficultyMix) ? config.difficultyMix.filter(level => levels.includes(level)) : [])]
    if (selected.length < 2) throw new Error('Для смешанного уровня выберите минимум две сложности.')
    return selected
  }
  throw new Error('Неизвестная сложность игры.')
}

const isCredibleOfficialCompletion = game => {
  if (!game?.progression?.official || !['easy', 'medium'].includes(game?.config?.difficulty)) return false
  if (!game.completedAt || game.endedEarly) return false
  const participants = Object.values(game.participants || {})
  if (!participants.length) return false
  const cards = participants.flatMap(participant => Object.values(participant?.cards || {}))
  return cards.length > 0 && cards.every(card => card.status !== 'available') && Number(game.queueCursor || 0) >= (Array.isArray(game.queue) ? game.queue.length : Object.keys(game.queue || {}).length)
}

const unlockForCompletion = (source, game, at = Date.now()) => {
  const progress = normalizeProgress(source, game.progression.bookId)
  if (!isCredibleOfficialCompletion(game) || progress.completedRoomIds[game.roomId]) return progress
  progress.completedRoomIds[game.roomId] = { difficulty: game.config.difficulty, completedAt: Number(game.completedAt || at) }
  if (game.config.difficulty === 'easy') progress.unlocked.medium = true
  if (game.config.difficulty === 'medium') {
    progress.unlocked.hard = true
    progress.unlocked.mixed = true
    progress.unlocked.all = true
  }
  progress.updatedAt = at
  return progress
}

module.exports = { levels, selections, defaultUnlocks, normalizeProgress, isDifficultyUnlocked, difficultyLevels, isCredibleOfficialCompletion, unlockForCompletion }
