import { useEffect, useState } from 'react'
import { categories, questions } from './data/questions'
import { ensureAuth, firebaseReady, joinSession, markPersonalViewed, saveAnswer, subscribeSession } from './lib/firebase'
import { recommendation, scoreAnswers } from './lib/scoring'
import type { Answer, Participant, Scores, Session } from './types'

const demoKey = (room: string) => `atmosphere-demo-${room}`
const getDemo = (room: string) => JSON.parse(localStorage.getItem(demoKey(room)) || 'null') as Session | null
const setDemo = (session: Session) => { localStorage.setItem(demoKey(session.roomId), JSON.stringify(session)); window.dispatchEvent(new StorageEvent('storage', { key: demoKey(session.roomId) })) }

function useParticipantSession(room: string) {
  const [session, setSession] = useState<Session | null>(null)
  useEffect(() => {
    if (!room) return
    if (!firebaseReady) {
      setSession(getDemo(room)); const sync = (event: StorageEvent) => { if (event.key === demoKey(room)) setSession(getDemo(room)) }
      window.addEventListener('storage', sync); return () => window.removeEventListener('storage', sync)
    }
    let active = true; let unsubscribe: () => void = () => undefined
    void ensureAuth().then(() => { if (active) unsubscribe = subscribeSession(room, value => { if (active) setSession(value) }) })
    return () => { active = false; unsubscribe() }
  }, [room])
  return [session, setSession] as const
}

const Shell = ({ children, screen = '' }: { children: React.ReactNode; screen?: string }) => <main className="mobile-flow"><div className={`phone-screen ${screen}`}>{children}</div></main>
const Action = ({ children, onClick, disabled = false, secondary = false }: { children: React.ReactNode; onClick?: () => void; disabled?: boolean; secondary?: boolean }) => <button className={secondary ? 'mobile-action secondary' : 'mobile-action'} disabled={disabled} onClick={onClick}>{children}</button>

function ScoreRing({ score }: { score: number }) {
  const [draw, setDraw] = useState(false)
  const circumference = 301.6
  useEffect(() => { const timer = window.setTimeout(() => setDraw(true), 120); return () => window.clearTimeout(timer) }, [])
  return <div className="report-ring"><svg viewBox="0 0 120 120" aria-hidden="true"><circle className="report-ring-track" cx="60" cy="60" r="48" /><circle className="report-ring-progress" cx="60" cy="60" r="48" style={{ strokeDasharray: circumference, strokeDashoffset: draw ? circumference * (1 - score / 100) : circumference }} /></svg><div><b>{score}%</b><small>РѕР±С‰РёР№<br />РѕСЂРёРµРЅС‚РёСЂ</small></div></div>
}

function PersonalReport({ participant, scores, onClose }: { participant: Participant; scores: Scores; onClose: () => void }) {
  const [showBars, setShowBars] = useState(false)
  useEffect(() => { const timer = window.setTimeout(() => setShowBars(true), 180); return () => window.clearTimeout(timer) }, [])
  return <Shell screen="report-screen"><p className="flow-label gold">РўР’РћРЇ РљРђР РўРћР§РљРђ</p><h1>{participant.nickname}</h1><div className="report-summary"><ScoreRing score={scores.total} /><p>РўС‘РїР»Р°СЏ, Р¶РёРІР°СЏ Р°С‚РјРѕСЃС„РµСЂР°<br />СЃ РїСЂРѕСЃС‚СЂР°РЅСЃС‚РІРѕРј<br />РґР»СЏ СЂРѕСЃС‚Р°</p></div><h2>РўРІРѕРё РїРѕРєР°Р·Р°С‚РµР»Рё</h2><div className="report-bars">{Object.entries(scores.categories).map(([id, value], index) => <div key={id} style={{ transitionDelay: `${index * 110}ms` }}><span>{categories[id as keyof typeof categories]}</span><b>{value}%</b><i><em style={{ width: showBars ? `${value}%` : '0%' }} /></i></div>)}</div><div className="wish-card"><small>РџРѕР¶РµР»Р°РЅРёРµ</small><p>{recommendation(scores)}</p></div><div className="report-downloads"><Action secondary onClick={() => window.print()}>РЎРєР°С‡Р°С‚СЊ PDF</Action><Action secondary onClick={() => createPoster(participant, scores)}>РЎРєР°С‡Р°С‚СЊ PNG</Action></div><button className="return-link" onClick={onClose}>Р’РµСЂРЅСѓС‚СЊСЃСЏ Рє РѕР¶РёРґР°РЅРёСЋ <span>в†’</span></button></Shell>
}

function createPoster(participant: Participant, scores: Scores) {
  const canvas = document.createElement('canvas'); canvas.width = 1080; canvas.height = 1350
  const ctx = canvas.getContext('2d'); if (!ctx) return
  ctx.fillStyle = '#03120e'; ctx.fillRect(0, 0, 1080, 1350); ctx.fillStyle = '#32ce8b'; ctx.font = '700 32px Arial'; ctx.fillText('Р”РРђР“РќРћРЎРўРРљРђ РђРўРњРћРЎР¤Р•Р Р«', 90, 100); ctx.fillStyle = '#eef5ee'; ctx.font = '700 72px Arial'; ctx.fillText(participant.nickname, 90, 205); ctx.fillStyle = '#32ce8b'; ctx.font = '700 144px Arial'; ctx.fillText(`${scores.total}%`, 90, 380)
  let y = 560; Object.entries(scores.categories).forEach(([id, value]) => { ctx.fillStyle = '#eef5ee'; ctx.font = '600 28px Arial'; ctx.fillText(categories[id as keyof typeof categories], 90, y); ctx.fillStyle = '#0d4c3a'; ctx.fillRect(90, y + 28, 900, 14); ctx.fillStyle = '#32ce8b'; ctx.fillRect(90, y + 28, 900 * value / 100, 14); y += 132 })
  const link = document.createElement('a'); link.href = canvas.toDataURL('image/png'); link.download = `РєР°СЂС‚РѕС‡РєР°-${participant.nickname}.png`; link.click()
}

export function MobileParticipantFlow({ room }: { room: string }) {
  const [session, setSession] = useParticipantSession(room)
  const [screen, setScreen] = useState<'intro' | 'nickname'>('intro')
  const [name, setName] = useState('')
  const [participant, setParticipant] = useState<Participant | null>(null)
  const [notice, setNotice] = useState('')
  const [saving, setSaving] = useState(false)
  const [reportReady, setReportReady] = useState(false)
  const [showReport, setShowReport] = useState(false)
  const activeQuestions = session?.questions?.length ? session.questions : questions

  useEffect(() => { const stored = localStorage.getItem(`atmosphere-participant-${room}`); if (stored) setParticipant(JSON.parse(stored)) }, [room])
  useEffect(() => { if (participant && session?.participants?.[participant.id]) setParticipant(session.participants[participant.id]) }, [session, participant?.id])
  useEffect(() => { if (participant?.status !== 'finished' || reportReady || showReport) return; const timer = window.setTimeout(() => setReportReady(true), 2600); return () => window.clearTimeout(timer) }, [participant?.status, reportReady, showReport])

  const join = async () => {
    if (!room || name.trim().length < 2) return setNotice('Р’РІРµРґРёС‚Рµ РЅРёРєРЅРµР№Рј РѕС‚ 2 РґРѕ 20 СЃРёРјРІРѕР»РѕРІ.')
    const user = firebaseReady ? await ensureAuth() : null
    const next: Participant = { id: user?.uid || crypto.randomUUID(), nickname: name.trim().slice(0, 20), joinedAt: Date.now(), status: 'waiting', currentQuestionIndex: 0, answers: {} }
    try {
      if (firebaseReady) await joinSession(room, next)
      else { const demo = getDemo(room); if (!demo) throw new Error('РљРѕРјРЅР°С‚Р° РЅРµ РЅР°Р№РґРµРЅР°'); setDemo({ ...demo, participants: { ...demo.participants, [next.id]: next } }) }
      localStorage.setItem(`atmosphere-participant-${room}`, JSON.stringify(next)); setParticipant(next)
    } catch (error) { setNotice(error instanceof Error ? error.message : 'РќРµ СѓРґР°Р»РѕСЃСЊ РїРѕРґРєР»СЋС‡РёС‚СЊСЃСЏ') }
  }
  const answer = async (value: Answer) => {
    if (!participant || !session || saving) return
    setSaving(true); const question = activeQuestions[participant.currentQuestionIndex]; const nextIndex = participant.currentQuestionIndex + 1
    try {
      if (firebaseReady) await saveAnswer(room, participant, question.id, value, nextIndex)
      else { const next = { ...participant, answers: { ...participant.answers, [question.id]: value }, currentQuestionIndex: nextIndex, status: nextIndex >= activeQuestions.length ? 'finished' as const : 'answering' as const, ...(nextIndex >= activeQuestions.length ? { completedAt: Date.now() } : {}) }; const demo = { ...session, participants: { ...session.participants, [participant.id]: next } }; setDemo(demo); setSession(demo); setParticipant(next) }
    } finally { setSaving(false) }
  }
  const openReport = async () => { if (!participant) return; try { if (firebaseReady) await markPersonalViewed(room, participant.id); else if (session) { const next = { ...participant, personalViewedAt: Date.now() }; const demo = { ...session, participants: { ...session.participants, [participant.id]: next } }; setDemo(demo); setSession(demo); setParticipant(next) } } finally { setShowReport(true) } }

  if (!room) return <Shell screen="intro-screen"><p className="flow-label">РћРќР›РђР™Рќ-Р”РРђР“РќРћРЎРўРРљРђ</p><h1>РќСѓР¶РµРЅ QR-РєРѕРґ РІРµРґСѓС‰РµРіРѕ</h1><p>РћС‚СЃРєР°РЅРёСЂСѓР№С‚Рµ РєРѕРґ, С‡С‚РѕР±С‹ РѕС‚РєСЂС‹С‚СЊ Р»РёС‡РЅСѓСЋ СЃСЃС‹Р»РєСѓ РЅР° РґРёР°РіРЅРѕСЃС‚РёРєСѓ.</p></Shell>
  if (!participant && screen === 'intro') return <Shell screen="intro-screen"><p className="flow-label gold">РћРќР›РђР™Рќ-Р”РРђР“РќРћРЎРўРРљРђ</p><h1>РђС‚РјРѕСЃС„РµСЂР°<br />РЅР°С€РµР№ РјРѕР»РѕРґС‘Р¶Рё</h1><p>РќРµР±РѕР»СЊС€Р°СЏ Р°РЅРѕРЅРёРјРЅР°СЏ РґРёР°РіРЅРѕСЃС‚РёРєР°, РєРѕС‚РѕСЂР°СЏ РїРѕРјРѕРіР°РµС‚ СѓРІРёРґРµС‚СЊ СЃРёР»СЊРЅС‹Рµ СЃС‚РѕСЂРѕРЅС‹ Рё С‚РѕС‡РєРё СЂРѕСЃС‚Р°.</p><div className="intro-info"><b>вњ¦</b><strong>16 РїСЂРѕСЃС‚С‹С… РІРѕРїСЂРѕСЃРѕРІ</strong><small>4 С‚РµРјС‹ В· РѕРєРѕР»Рѕ 4 РјРёРЅСѓС‚ В· Р±РµР· РѕС†РµРЅРѕРє</small><i /><span>Р’ РєРѕРЅС†Рµ С‚С‹ РїРѕР»СѓС‡РёС€СЊ Р»РёС‡РЅСѓСЋ РєР°СЂС‚РѕС‡РєСѓ СЃ СЂРµР·СѓР»СЊС‚Р°С‚Р°РјРё.</span></div><Action onClick={() => setScreen('nickname')}>РќР°С‡Р°С‚СЊ РґРёР°РіРЅРѕСЃС‚РёРєСѓ</Action><small className="flow-footnote">РўРІРѕСЏ РёСЃРєСЂРµРЅРЅРѕСЃС‚СЊ РїРѕРјРѕР¶РµС‚ РЅР°Рј СЃС‚Р°С‚СЊ Р±Р»РёР¶Рµ.</small></Shell>
  if (!participant) return <Shell screen="nickname-screen"><p className="flow-label">РЁРђР“ 1 РР— 2</p><h1>РљР°Рє С‚РµР±СЏ<br />РЅР°Р·С‹РІР°С‚СЊ?</h1><p>РњРѕР¶РЅРѕ СѓРєР°Р·Р°С‚СЊ РёРјСЏ РёР»Рё РїСЂРёРґСѓРјР°С‚СЊ РЅРёРєРЅРµР№Рј вЂ” СЂРµР·СѓР»СЊС‚Р°С‚С‹ РІСЃС‘ СЂР°РІРЅРѕ РѕСЃС‚Р°РЅСѓС‚СЃСЏ Р°РЅРѕРЅРёРјРЅС‹РјРё.</p><input value={name} onChange={event => setName(event.target.value)} placeholder="РќР°РїСЂРёРјРµСЂ, В«РЎРІРµС‚В»" maxLength={20} /><small className="input-help">Р­С‚Рѕ РЅСѓР¶РЅРѕ С‚РѕР»СЊРєРѕ РґР»СЏ С‚РІРѕРµР№ Р»РёС‡РЅРѕР№ РєР°СЂС‚РѕС‡РєРё.</small><div className="flow-note"><b>Р’Р°Р¶РЅРѕ</b><p>РќРµС‚ РїСЂР°РІРёР»СЊРЅС‹С… РёР»Рё РЅРµРїСЂР°РІРёР»СЊРЅС‹С… РѕС‚РІРµС‚РѕРІ. Р“Р»Р°РІРЅРѕРµ вЂ” РѕС‚РІРµС‡Р°С‚СЊ С‡РµСЃС‚РЅРѕ.</p></div><Action onClick={() => void join()}>РџСЂРѕРґРѕР»Р¶РёС‚СЊ</Action>{notice && <p className="flow-error">{notice}</p>}</Shell>
  if (!session || session.phase === 'lobby') return <Shell screen="waiting-screen"><div className="waiting-orbit"><i /><i /><b>вњ¦</b></div><p className="flow-label">РџРћР”РљР›Р®Р§Р•РќРР• РџРћР”РўР’Р•Р Р–Р”Р•РќРћ</p><h1>Р–РґС‘Рј РІРµРґСѓС‰РµРіРѕ</h1><p>РўС‹ СѓР¶Рµ РІ РєРѕРјРЅР°С‚Рµ. РљР°Рє С‚РѕР»СЊРєРѕ РІРµРґСѓС‰РёР№ Р·Р°РїСѓСЃС‚РёС‚ РґРёР°РіРЅРѕСЃС‚РёРєСѓ, РїРµСЂРІС‹Р№ РІРѕРїСЂРѕСЃ РїРѕСЏРІРёС‚СЃСЏ Р°РІС‚РѕРјР°С‚РёС‡РµСЃРєРё.</p><div className="waiting-status"><span /><div><b>РЎРѕР±РёСЂР°РµРј СѓС‡Р°СЃС‚РЅРёРєРѕРІ</b><small>РќРµ Р·Р°РєСЂС‹РІР°Р№ СЌС‚Сѓ СЃС‚СЂР°РЅРёС†Сѓ</small></div></div></Shell>
  if (participant.status === 'finished' && !reportReady) return <Shell screen="report-loading"><div className="report-loader"><i /><b>вњ¦</b></div><p className="flow-label">Р“РћРўРћР’Рћ</p><h1>РџРѕРґРіРѕС‚Р°РІР»РёРІР°РµРј<br />С‚РІРѕР№ РѕС‚С‡С‘С‚</h1><p>РЎРѕР±РёСЂР°РµРј С‚РІРѕСЋ Р»РёС‡РЅСѓСЋ РєР°СЂС‚РѕС‡РєСѓ вЂ” СЌС‚Рѕ Р·Р°Р№РјС‘С‚ РІСЃРµРіРѕ РїР°СЂСѓ СЃРµРєСѓРЅРґ.</p></Shell>
  if (participant.status === 'finished' && !showReport) return <Shell screen="report-ready"><div className="ready-spark">вњ¦</div><p className="flow-label">РўР’РћР™ РћРўР§РЃРў Р“РћРўРћР’</p><h1>{participant.nickname}, СЃРїР°СЃРёР±Рѕ!</h1><p>РўС‹ РѕС‚РІРµС‚РёР»(Р°) РЅР° РІСЃРµ РІРѕРїСЂРѕСЃС‹. РўРІРѕСЏ Р»РёС‡РЅР°СЏ РєР°СЂС‚РѕС‡РєР° РіРѕС‚РѕРІР° Рё РґРѕСЃС‚СѓРїРЅР° С‚РѕР»СЊРєРѕ С‚РµР±Рµ.</p><Action onClick={() => void openReport()}>РћС‚РєСЂС‹С‚СЊ Р»РёС‡РЅС‹Р№ РѕС‚С‡С‘С‚ <span>в†’</span></Action></Shell>
  if (participant.status === 'finished') return <PersonalReport participant={participant} scores={scoreAnswers(participant.answers || {}, activeQuestions)} onClose={() => setShowReport(false)} />
  const question = activeQuestions[participant.currentQuestionIndex]
  const done = Math.round(participant.currentQuestionIndex / activeQuestions.length * 100)
  return <Shell screen="question-screen"><div className="question-top"><div><span>Р’РћРџР РћРЎ {participant.currentQuestionIndex + 1} / {activeQuestions.length}</span><small>{categories[question.category]}</small></div><b>{done}%</b></div><div className="question-progress"><i style={{ width: `${done}%` }} /></div><h1>{question.title}</h1><p>Р’С‹Р±РµСЂРё РІР°СЂРёР°РЅС‚, РєРѕС‚РѕСЂС‹Р№ Р±Р»РёР¶Рµ РІСЃРµРіРѕ Рє С‚РµР±Рµ.</p><div className="answer-options">{(['A', 'B', 'C', 'D'] as Answer[]).map(letter => <button disabled={saving} key={letter} onClick={() => void answer(letter)}><b>{letter}</b><span>{question.options[letter]}</span></button>)}</div><small className="skip-note">РћС‚РІРµС‡Р°Р№ С‚Р°Рє, РєР°Рє С‡СѓРІСЃС‚РІСѓРµС€СЊ вЂ” Р·РґРµСЃСЊ РЅРµС‚ РїСЂР°РІРёР»СЊРЅС‹С… РѕС‚РІРµС‚РѕРІ.</small></Shell>
}
