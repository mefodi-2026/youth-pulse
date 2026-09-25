const fs = require('node:fs')
const path = require('node:path')

const sourcePath = process.argv[2]
const outputPath = process.argv[3] || path.join(__dirname, '..', 'data', 'proverbs-pack-v2.json')
if (!sourcePath) throw new Error('Usage: node import-proverbs-usfm.cjs <PRO.usfm> [output.json]')

const normalize = value => String(value || '').replace(/\s+/g, ' ').trim()
const source = fs.readFileSync(sourcePath, 'utf8')
const verses = []
let chapter = 0
for (const rawLine of source.split(/\r?\n/)) {
  const chapterMatch = rawLine.match(/^\\c\s+(\d+)/)
  if (chapterMatch) { chapter = Number(chapterMatch[1]); continue }
  const verseMatch = rawLine.match(/^\\v\s+(\d+)\s+(.+?)\s*$/)
  if (!verseMatch) continue
  verses.push({ chapter, verse: Number(verseMatch[1]), fullText: normalize(verseMatch[2]) })
}

const expectedChapterCounts = [33,22,35,29,23,35,27,36,18,32,31,28,26,35,33,33,28,24,29,30,31,29,35,34,28,28,27,28,27,33,31]
if (verses.length !== 918) throw new Error(`Expected 918 Proverbs verses, got ${verses.length}`)
expectedChapterCounts.forEach((expected, index) => {
  const actual = verses.filter(item => item.chapter === index + 1).length
  if (actual !== expected) throw new Error(`Proverbs ${index + 1}: expected ${expected}, got ${actual}`)
})

const curated = {
  easy: new Set(['3:5','4:23','10:12','12:25','15:1','16:3','16:18','17:17','18:10','27:1']),
  medium: new Set(['10:19','11:25','12:18','13:10','14:29','15:22','16:24','17:22','18:21','22:6']),
  hard: new Set(['1:7','3:27','3:34','11:2','12:22','14:31','15:33','20:24','21:23','28:13']),
}
const archaic = /\b(ибо|дабы|сие|сей|сия|оный|доколе|стез[еяию]|уста|чрево|нечестив|праведник|беззакон|благоговен|посрамлен|преисподн|обличен|кощун|внемл|взыск|гнуш|мерзост)\w*/giu
const dependentOpening = /^(и|а|но|ибо|потому|когда|если|тогда|чтобы|котор|кто|так|за то|вот)\b/iu

const splitCandidates = fullText => {
  const candidates = []
  const add = (index, weight) => {
    if (index > 12 && index < fullText.length - 12) candidates.push({ index, weight })
  }
  for (const match of fullText.matchAll(/[;:!?]\s+/g)) add(match.index + match[0].trimEnd().length, 0)
  for (const match of fullText.matchAll(/[,—–]\s+/g)) add(match.index + match[0].trimEnd().length, 5)
  for (const match of fullText.matchAll(/\s+(?:и|но|а|ибо|потому что|когда|чтобы|если|кто|так что)\s+/giu)) add(match.index, 10)
  for (const match of fullText.matchAll(/\s+/g)) add(match.index, 30)
  const target = fullText.length * 0.47
  return candidates
    .sort((left, right) => (left.weight + Math.abs(left.index - target) / fullText.length * 20) - (right.weight + Math.abs(right.index - target) / fullText.length * 20))
    .map(selected => ({ start: normalize(fullText.slice(0, selected.index)), end: normalize(fullText.slice(selected.index)) }))
    .filter((candidate, index, all) => candidate.start && candidate.end && all.findIndex(item => item.start === candidate.start && item.end === candidate.end) === index)
}

const complexity = item => {
  const id = `${item.chapter}:${item.verse}`
  const words = item.fullText.split(/\s+/).length
  const clauses = (item.fullText.match(/[,;:—–]/g) || []).length
  const lexical = (item.fullText.match(archaic) || []).length
  const continuation = dependentOpening.test(item.fullText) ? 3 : 0
  const quotation = /[«»“”]/u.test(item.fullText) ? 2 : 0
  const curatedBias = curated.easy.has(id) ? -100 : curated.medium.has(id) ? 0 : curated.hard.has(id) ? 100 : 0
  return curatedBias + words * 0.8 + clauses * 3 + lexical * 8 + continuation * 7 + quotation * 3
}

const seenFullText = new Set()
const usedStarts = new Set()
const usedEnds = new Set()
const prepared = verses.map(item => {
  const fullKey = item.fullText.toLocaleLowerCase('ru-RU')
  if (seenFullText.has(fullKey)) {
    const fallbackSplit = splitCandidates(item.fullText)[0]
    return { ...item, ...fallbackSplit, enabled: false, verificationStatus: 'rejected', exclusionReason: 'duplicate-full-text' }
  }
  seenFullText.add(fullKey)
  const split = splitCandidates(item.fullText).find(candidate => !usedStarts.has(candidate.start.toLocaleLowerCase('ru-RU')) && !usedEnds.has(candidate.end.toLocaleLowerCase('ru-RU')))
  if (!split) return { ...item, enabled: false, verificationStatus: 'rejected', exclusionReason: 'ambiguous-fragments' }
  usedStarts.add(split.start.toLocaleLowerCase('ru-RU'))
  usedEnds.add(split.end.toLocaleLowerCase('ru-RU'))
  return { ...item, ...split, enabled: true, verificationStatus: 'verified' }
})
const ranked = prepared.filter(item => item.enabled).map(item => ({ ...item, score: complexity(item) })).sort((left, right) => left.score - right.score || left.chapter - right.chapter || left.verse - right.verse)
const easySize = Math.ceil(ranked.length / 3)
const mediumSize = Math.ceil((ranked.length - easySize) / 2)
const difficultyByReference = new Map(ranked.map((item, index) => [`${item.chapter}:${item.verse}`, index < easySize ? 'easy' : index < easySize + mediumSize ? 'medium' : 'hard']))

const entries = prepared.map(item => {
  const id = `pro-rst-1876-${String(item.chapter).padStart(2, '0')}-${String(item.verse).padStart(3, '0')}`
  const start = item.start || ''
  const end = item.end || ''
  if (item.enabled && (!start || !end || normalize(`${start} ${end}`) !== item.fullText)) throw new Error(`Invalid split for ${id}`)
  return {
    id,
    bookId: 'PRO',
    book: 'Притчи Соломона',
    chapter: item.chapter,
    verse: String(item.verse),
    reference: `Притчи ${item.chapter}:${item.verse}`,
    translationId: 'russyn-1876',
    translation: 'Синодальный перевод (1876)',
    contentVersion: 'russyn-2022-11-25/proverbs-v2',
    fullText: item.fullText,
    start,
    end,
    difficulty: difficultyByReference.get(`${item.chapter}:${item.verse}`) || 'hard',
    enabled: item.enabled,
    verificationStatus: item.verificationStatus,
    ...(item.exclusionReason ? { exclusionReason: item.exclusionReason } : {}),
  }
})

const counts = entries.reduce((result, entry) => ({ ...result, [entry.difficulty]: (result[entry.difficulty] || 0) + 1 }), {})
const availableCounts = entries.filter(entry => entry.enabled && entry.verificationStatus === 'verified').reduce((result, entry) => ({ ...result, [entry.difficulty]: (result[entry.difficulty] || 0) + 1 }), {})
if (Math.max(...Object.values(availableCounts)) - Math.min(...Object.values(availableCounts)) > 1) throw new Error(`Unbalanced difficulties: ${JSON.stringify(availableCounts)}`)

const pack = {
  packId: 'proverbs-synodal-v2',
  version: 2,
  schemaVersion: 2,
  title: 'Притчи — Синодальный перевод',
  description: 'Полная книга Притчей Соломона. Сложность распределена по редакционной модели: узнаваемость, смысловая самостоятельность, синтаксис и архаичная лексика.',
  bookId: 'PRO',
  translationId: 'russyn-1876',
  translation: 'Синодальный перевод (1876)',
  sourceUrl: 'https://ebible.org/bible/details.php?id=russyn',
  sourceEdition: 'eBible.org RUSSYN USFM, 2022-11-25',
  license: 'Public Domain',
  contentVersion: 'russyn-2022-11-25/proverbs-v2',
  status: 'published',
  official: true,
  editorialMethod: 'curated-reference-and-semantic-complexity-v1',
  chapterVerseCounts: expectedChapterCounts,
  unavailableEntries: entries.filter(entry => !entry.enabled).map(entry => ({ id: entry.id, reference: entry.reference, reason: entry.exclusionReason })),
  entries,
}

fs.writeFileSync(outputPath, `${JSON.stringify(pack, null, 2)}\n`, 'utf8')
console.log(JSON.stringify({ outputPath, entries: entries.length, counts, availableCounts, unavailable: pack.unavailableEntries }, null, 2))
