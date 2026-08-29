import { questions as diagnosticQuestions } from '../data/questions'
import { getModeManifest, productionModes } from './modeRegistry'
import { resolveCanonicalPackQuestions } from './contentPackAdapter'
import type { ContentPack } from '../types'
import './modeRegistry.contract.test'
import './wheel/contract.test'

const assert: (condition: unknown, message: string) => asserts condition = (condition, message) => {
  if (!condition) throw new Error(`Architecture contract failed: ${message}`)
}

const diagnostic = getModeManifest()
const quiz = getModeManifest('quiz')
const wheel = getModeManifest('wheel')

assert(productionModes.length === 3, 'production registry must contain diagnostic, quiz and wheel')
assert(diagnostic.id === 'diagnostic', 'legacy rooms without mode must resolve to diagnostic')
assert(quiz.id === 'quiz', 'quiz must resolve through the registry')
assert(wheel.id === 'wheel', 'wheel must resolve through the registry')
assert(diagnostic.runtime !== quiz.runtime, 'each mode must own an independent runtime')
assert(wheel.runtime !== diagnostic.runtime && wheel.runtime !== quiz.runtime, 'wheel must own an independent runtime')
assert(wheel.dataContract.roomStateSchema === 'wheel-room-state-v1', 'wheel state schema must be explicit')
assert(wheel.runtime.getQuestions({}, []).length === 0, 'wheel must not inherit question-pack fallback logic')

const legacySession = { questions: diagnosticQuestions.slice(0, 3), gameTypeId: 'diagnostic' as const }
assert(diagnostic.runtime.getQuestions(legacySession, diagnosticQuestions).length === 3, 'legacy room questions must not fall back to 70')

const canonical = diagnosticQuestions.slice(0, 3)
const legacyContent = diagnosticQuestions.slice(0, 10)
assert(resolveCanonicalPackQuestions({ questions: canonical, legacyContentQuestions: legacyContent }) === canonical, 'ContentPack.questions must be canonical')
assert(resolveCanonicalPackQuestions({ legacyContentQuestions: legacyContent }).length === 10, 'legacy content adapter must remain readable')

const diagnosticScore = diagnostic.runtime.score({ [canonical[0].id]: 'A' }, canonical)
assert(diagnosticScore.maximumPoints === 9, 'diagnostic scoring must use the supplied three-question snapshot')
assert(diagnosticScore.points === 3, 'diagnostic standard scoring must remain 3/2/1/0')

const quizScore = quiz.runtime.score({ q1: 'A' }, [{ id: 'q1', title: 'Public quiz question', options: { A: 'A', B: 'B', C: 'C', D: 'D' } }])
assert(quizScore.points === 0 && quizScore.total === 0 && quizScore.maximumPoints === 1, 'browser quiz runtime must not infer a correct answer')

const diagnosticPack = { packId: 'diagnostic-pack', questions: canonical } as ContentPack
const diagnosticSelection = diagnostic.setupPolicy.initialSelection({ defaultPackId: diagnosticPack.packId, systemPacks: { [diagnosticPack.packId]: diagnosticPack }, workspacePacks: {} })
assert(diagnosticSelection?.templateSource === 'system', 'diagnostic must be able to use a published system pack directly')
diagnostic.setupPolicy.validateSelection({ defaultPackId: diagnosticPack.packId, selection: diagnosticSelection!, systemPacks: { [diagnosticPack.packId]: diagnosticPack }, workspacePacks: {} })

const quizPack = { packId: 'quiz-pack', mode: 'quiz', gameTypeId: 'quiz', questions: [{ id: 'q1', title: 'Public quiz question', options: { A: 'A', B: 'B', C: 'C', D: 'D' } }] } as ContentPack
const quizSelection = quiz.setupPolicy.initialSelection({ defaultPackId: diagnosticPack.packId, systemPacks: { [quizPack.packId]: quizPack }, workspacePacks: { [quizPack.packId]: quizPack } })
assert(quizSelection?.templateSource === 'workspace', 'quiz must select a leader-owned workspace copy')
quiz.setupPolicy.validateSelection({ defaultPackId: diagnosticPack.packId, selection: quizSelection!, systemPacks: { [quizPack.packId]: quizPack }, workspacePacks: { [quizPack.packId]: quizPack } })

export const architectureContractPassed = true
