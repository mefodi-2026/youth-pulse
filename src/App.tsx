import { useEffect, useMemo, useState } from 'react'
import QRCode from 'qrcode'
import { categories, questions } from './data/questions'
import { archiveSession, createSession, ensureAuth, firebaseReady, joinSession, markPersonalViewed, saveAnswer, saveQuestionBank, saveSessionQuestions, subscribeQuestionBank, subscribeSession, subscribeSessionArchives, updatePhase } from './lib/firebase'
import { recommendation, scoreAnswers } from './lib/scoring'
import { StageDashboard } from './StageDashboard'
import { MobileParticipantFlow } from './MobileParticipantFlow'
import type { Answer, Participant, Question, Scores, Session, SessionArchive, SessionPhase } from './types'

const demoKey = (room: string) => `atmosphere-demo-${room}`
const getDemo = (room: string) => JSON.parse(localStorage.getItem(demoKey(room)) || 'null') as Session | null
const setDemo = (session: Session) => { localStorage.setItem(demoKey(session.roomId), JSON.stringify(session)); window.dispatchEvent(new StorageEvent('storage', { key: demoKey(session.roomId) })) }
const makeRoom = () => Math.random().toString(36).slice(2, 8).toUpperCase()
const appBasePath = import.meta.env.BASE_URL.replace(/\/$/, '')
const currentPath = () => window.location.pathname.replace(/\/+$/, '') || '/'
const queryRoom = () => new URLSearchParams(window.location.search).get('room')?.toUpperCase() || ''
const go = (path: string) => { window.history.pushState({}, '', `${appBasePath}${path}`); window.dispatchEvent(new PopStateEvent('popstate')) }

const Glass = ({ children, className = '' }: { children: React.ReactNode; className?: string }) => <section className={`glass ${className}`}>{children}</section>
const Button = ({ children, secondary = false, disabled, onClick, className = '' }: { children: React.ReactNode; secondary?: boolean; disabled?: boolean; onClick?: () => void; className?: string }) => <button className={`${secondary ? 'button secondary' : 'button'} ${className}`} disabled={disabled} onClick={onClick}>{children}</button>
const phaseText = (phase: SessionPhase) => ({ lobby: 'РЎР±РѕСЂ СѓС‡Р°СЃС‚РЅРёРєРѕРІ', live: 'Р”РёР°РіРЅРѕСЃС‚РёРєР° РёРґС‘С‚', personal: 'Р›РёС‡РЅС‹Рµ СЂРµР·СѓР»СЊС‚Р°С‚С‹', resultsIntro: 'Р“РѕС‚РѕРІРёРј РѕР±С‰РёР№ СЂРµР·СѓР»СЊС‚Р°С‚', resultsReal: 'РћР±С‰РёР№ СЂРµР·СѓР»СЊС‚Р°С‚ РѕС‚РєСЂС‹С‚', closed: 'РЎРµСЃСЃРёСЏ Р·Р°РІРµСЂС€РµРЅР°' })[phase]

function useRoute() {
  const [path, setPath] = useState(currentPath())
  useEffect(() => { const listener = () => setPath(currentPath()); window.addEventListener('popstate', listener); return () => window.removeEventListener('popstate', listener) }, [])
  return path
}

function useRoom(room: string) {
  const [session, setSession] = useState<Session | null>(() => room ? getDemo(room) : null)
  const [connection, setConnection] = useState<'idle' | 'connecting' | 'ready' | 'error'>(room ? 'connecting' : 'idle')
  useEffect(() => {
    if (!room) return
    if (firebaseReady) {
      let active = true
      let unsubscribe: () => void = () => undefined
      setConnection('connecting')
      void ensureAuth().then(() => {
        if (!active) return
        unsubscribe = subscribeSession(room, value => { if (active) { setSession(value); setConnection('ready') } }, () => { if (active) setConnection('error') })
      }).catch(() => { if (active) setConnection('error') })
      return () => { active = false; unsubscribe() }
    }
    const sync = (event: StorageEvent) => { if (event.key === demoKey(room)) setSession(getDemo(room)) }
    window.addEventListener('storage', sync); setSession(getDemo(room)); setConnection('ready')
    return () => window.removeEventListener('storage', sync)
  }, [room])
  return [session, setSession, connection] as const
}

function App() {
  const path = useRoute()
  if (path.endsWith('/host')) return <Host />
  if (path.endsWith('/join')) return <MobileParticipantFlow room={queryRoom()} />
  if (path.endsWith('/stage')) return <StageDashboard room={queryRoom()} />
  if (path.endsWith('/results')) return <Results room={queryRoom()} />
  return <Landing />
}

function Landing() {
  return <main className="landing"><div className="orb orb-a" /><div className="orb orb-b" /><Glass className="landing-card"><p className="eyebrow">РРќРўР•Р РђРљРўРР’РќРђРЇ Р”РРђР“РќРћРЎРўРРљРђ</p><h1>РђС‚РјРѕСЃС„РµСЂР°<br />РЅР°С€РµР№ РјРѕР»РѕРґС‘Р¶Рё</h1><p>Р‘РµСЂРµР¶РЅР°СЏ РІСЃС‚СЂРµС‡Р°, РєРѕС‚РѕСЂР°СЏ РїРѕРјРѕРіР°РµС‚ СѓРІРёРґРµС‚СЊ С‚РѕС‡РєРё СЂРѕСЃС‚Р° вЂ” Р±РµР· СЃСЂР°РІРЅРµРЅРёР№ Рё РѕСЃСѓР¶РґРµРЅРёСЏ.</p><div className="landing-actions"><Button onClick={() => go('/host')}>РћС‚РєСЂС‹С‚СЊ РїР°РЅРµР»СЊ РІРµРґСѓС‰РµРіРѕ</Button><Button secondary onClick={() => go('/join?room=DEMO42')}>РћС‚РєСЂС‹С‚СЊ РґРµРјРѕ СѓС‡Р°СЃС‚РЅРёРєР°</Button></div><small>{questions.length} РІРѕРїСЂРѕСЃРѕРІ В· {Object.keys(categories).length} С‚РµРј В· Р±РµР· РѕС†РµРЅРѕРє</small></Glass></main>
}

type HostTab = 'overview' | 'rooms' | 'questions' | 'export' | 'settings'
function Host() {
  const [room, setRoom] = useState(() => localStorage.getItem('atmosphere-host-room') || '')
  const [session, setSession] = useRoom(room)
  const [qr, setQr] = useState('')
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState('')
  const [tab, setTab] = useState<HostTab>('overview')
  const [archives, setArchives] = useState<Record<string, SessionArchive>>({})
  const [questionBank, setQuestionBank] = useState<Question[]>(questions)
  const [questionDraft, setQuestionDraft] = useState({ category: 'communication' as Question['category'], title: '', options: ['', '', '', ''] })
  const [editingQuestionId, setEditingQuestionId] = useState<string | null>(null)
  const [questionSaving, setQuestionSaving] = useState(false)
  const [questionError, setQuestionError] = useState('')
  const [publicOrigin, setPublicOrigin] = useState(() => localStorage.getItem('atmosphere-public-origin') || import.meta.env.VITE_PUBLIC_ORIGIN || window.location.origin)
  const basePath = window.location.pathname.replace(/\/host$/, '')
  const publicUrl = (path: string) => `${publicOrigin.replace(/\/$/, '')}${basePath}${path}`
  const hostUrl = (path: string) => `${basePath}${path}`
  const joinUrl = room ? publicUrl(`/join?room=${room}`) : ''
  const participants = Object.values(session?.participants || {})
  const finished = participants.filter(p => p.status === 'finished').length
  const answering = participants.filter(p => p.status === 'answering').length
  const allFinished = participants.length > 0 && finished === participants.length
  const menu: Array<[HostTab, string, string]> = [['overview', 'РћР±Р·РѕСЂ', 'вЊЃ'], ['rooms', 'РљРѕРјРЅР°С‚С‹', 'в—«'], ['questions', 'Р’РѕРїСЂРѕСЃС‹', 'в—Њ'], ['export', 'Р­РєСЃРїРѕСЂС‚', 'в†“'], ['settings', 'РќР°СЃС‚СЂРѕР№РєРё', 'вљ™']]

  useEffect(() => { if (joinUrl) QRCode.toDataURL(joinUrl, { margin: 0, width: 216, color: { dark: '#03120e', light: '#eef5ee' } }).then(setQr) }, [joinUrl])
  useEffect(() => { localStorage.setItem('atmosphere-public-origin', publicOrigin) }, [publicOrigin])
  useEffect(() => {
    if (!firebaseReady) {
      const localArchives = JSON.parse(localStorage.getItem('atmosphere-archives') || '{}') as Record<string, SessionArchive>
      setArchives(localArchives)
      return
    }
    let unsubscribe: () => void = () => undefined
    void ensureAuth().then(() => { unsubscribe = subscribeSessionArchives(setArchives) }).catch(() => undefined)
    return () => unsubscribe()
  }, [])
  useEffect(() => {
    const stored = JSON.parse(localStorage.getItem('atmosphere-question-bank') || 'null') as Question[] | null
    // РЎС‚Р°СЂС‹Р№ Р±СЂР°СѓР·РµСЂРЅС‹Р№ РєСЌС€ РЅР° 16 РІРѕРїСЂРѕСЃРѕРІ РЅРµ РґРѕР»Р¶РµРЅ РїРµСЂРµРєСЂС‹РІР°С‚СЊ РЅРѕРІС‹Р№ РІСЃС‚СЂРѕРµРЅРЅС‹Р№ Р±Р°РЅРє.
    const localQuestions = stored?.length && stored.length >= questions.length ? stored : null
    if (!firebaseReady) {
      setQuestionBank(localQuestions || questions)
      return
    }
    let unsubscribe: () => void = () => undefined
    const applyRemoteBank = (value: Question[] | null) => {
      if (value?.length && value.length >= questions.length) {
        setQuestionBank(value)
        localStorage.setItem('atmosphere-question-bank', JSON.stringify(value))
        return
      }
      // Р•СЃР»Рё РІ Firebase РѕСЃС‚Р°Р»Р°СЃСЊ СЃС‚Р°СЂР°СЏ РІРµСЂСЃРёСЏ РЅР° 16 РІРѕРїСЂРѕСЃРѕРІ, РѕРґРёРЅ СЂР°Р· Р·Р°РјРµРЅСЏРµРј РµС‘ Р°РєС‚СѓР°Р»СЊРЅС‹Рј Р±Р°РЅРєРѕРј.
      if (value?.length && value.length < questions.length) {
        setQuestionBank(questions)
        void saveQuestionBank(questions).catch(() => undefined)
        return
      }
      setQuestionBank(localQuestions || questions)
    }
    void ensureAuth().then(() => { unsubscribe = subscribeQuestionBank(applyRemoteBank, () => setQuestionBank(localQuestions || questions)) }).catch(() => setQuestionBank(localQuestions || questions))
    return () => unsubscribe()
  }, [])
  const create = async () => {
    setBusy(true)
    const newRoom = makeRoom()
    try {
      if (firebaseReady) { const user = await ensureAuth(); if (!user) throw new Error('РќРµ СѓРґР°Р»РѕСЃСЊ РІРѕР№С‚Рё РІ Firebase'); await createSession(newRoom, user.uid, questionBank) }
      else setDemo({ roomId: newRoom, createdAt: Date.now(), phase: 'lobby', maxParticipants: 30, hostUid: 'demo-host', questions: questionBank, participants: {} })
      localStorage.setItem('atmosphere-host-room', newRoom); setRoom(newRoom); setTab('overview')
    } finally { setBusy(false) }
  }
  const changePhase = async (next: SessionPhase) => {
    if (!session) return
    setActionError('')
    try {
      if (firebaseReady) {
        if (next === 'closed') {
          const archived = await archiveSession(session)
          setSession(archived)
          setArchives(prev => ({ ...prev, [room]: archived }))
        } else await updatePhase(room, next)
      } else {
        const nextSession = { ...session, phase: next, ...(next === 'resultsIntro' ? { resultsIntroStartedAt: Date.now() } : {}), ...(next === 'closed' ? { closedAt: Date.now() } : {}) }
        setDemo(nextSession); setSession(nextSession)
        if (next === 'closed') {
          const archived = { ...nextSession, archivedAt: Date.now() } as SessionArchive
          const localArchives = JSON.parse(localStorage.getItem('atmosphere-archives') || '{}') as Record<string, SessionArchive>
          localStorage.setItem('atmosphere-archives', JSON.stringify({ ...localArchives, [room]: archived }))
          setArchives(prev => ({ ...prev, [room]: archived }))
        }
      }
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'РќРµ СѓРґР°Р»РѕСЃСЊ РёР·РјРµРЅРёС‚СЊ СЃРѕСЃС‚РѕСЏРЅРёРµ СЃРµСЃСЃРёРё')
    }
  }
  const start = () => {
    window.open(hostUrl(`/stage?room=${room}`), 'atmosphere-stage')
    void changePhase('live')
  }
  const showResults = () => {
    window.open(hostUrl(`/results?room=${room}`), 'atmosphere-results')
    void changePhase('resultsIntro')
    window.setTimeout(() => { void changePhase('resultsReal') }, 20000)
  }
  const resetQuestionDraft = (category: Question['category'] = 'communication') => {
    setEditingQuestionId(null)
    setQuestionDraft({ category, title: '', options: ['', '', '', ''] })
  }
  const editQuestion = (question: Question) => {
    setEditingQuestionId(question.id)
    setQuestionDraft({ category: question.category, title: question.title, options: [question.options.A, question.options.B, question.options.C, question.options.D] })
    setTab('questions')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }
  const persistQuestionBank = async (nextBank: Question[]) => {
    setQuestionError('')
    if (firebaseReady) {
      let globalError: unknown = null
      try {
        await saveQuestionBank(nextBank)
        localStorage.removeItem('atmosphere-question-bank')
      } catch (error) {
        globalError = error
        localStorage.setItem('atmosphere-question-bank', JSON.stringify(nextBank))
      }
      if (session && session.phase !== 'closed') {
        try {
          await saveSessionQuestions(room, nextBank)
        } catch (error) {
          if (!globalError) globalError = error
        }
      }
      if (globalError) {
        setQuestionError(`Р’РѕРїСЂРѕСЃ СЃРѕС…СЂР°РЅС‘РЅ Р»РѕРєР°Р»СЊРЅРѕ${session && session.phase !== 'closed' ? ' Рё РІ С‚РµРєСѓС‰СѓСЋ РєРѕРјРЅР°С‚Сѓ' : ''}. Firebase РїРѕРєР° РЅРµРґРѕСЃС‚СѓРїРµРЅ: ${globalError instanceof Error ? globalError.message : 'РїСЂРѕРІРµСЂСЊС‚Рµ Rules'}`)
      }
    } else localStorage.setItem('atmosphere-question-bank', JSON.stringify(nextBank))
    setQuestionBank(nextBank)
  }
  const saveQuestion = async () => {
    if (!questionDraft.title.trim() || questionDraft.options.some(option => !option.trim())) return
    setQuestionSaving(true)
    const nextQuestion: Question = { id: editingQuestionId || `${questionDraft.category}-${Date.now()}`, category: questionDraft.category, title: questionDraft.title.trim(), options: { A: questionDraft.options[0].trim(), B: questionDraft.options[1].trim(), C: questionDraft.options[2].trim(), D: questionDraft.options[3].trim() } }
    const nextBank = editingQuestionId ? questionBank.map(question => question.id === editingQuestionId ? nextQuestion : question) : [...questionBank, nextQuestion]
    try {
      await persistQuestionBank(nextBank)
      resetQuestionDraft()
    } catch (error) {
      setQuestionError(error instanceof Error ? error.message : 'РќРµ СѓРґР°Р»РѕСЃСЊ СЃРѕС…СЂР°РЅРёС‚СЊ РІРѕРїСЂРѕСЃ')
    } finally { setQuestionSaving(false) }
  }
  const deleteQuestion = async (question: Question) => {
    if (!window.confirm(`РЈРґР°Р»РёС‚СЊ РІРѕРїСЂРѕСЃ В«${question.title}В»?`)) return
    setQuestionSaving(true)
    try {
      await persistQuestionBank(questionBank.filter(item => item.id !== question.id))
      if (editingQuestionId === question.id) resetQuestionDraft()
    } catch (error) {
      setQuestionError(error instanceof Error ? error.message : 'РќРµ СѓРґР°Р»РѕСЃСЊ СѓРґР°Р»РёС‚СЊ РІРѕРїСЂРѕСЃ')
    } finally { setQuestionSaving(false) }
  }
  const warning = !firebaseReady ? 'Р”Р»СЏ СЂР°Р±РѕС‚С‹ СЃ РЅРµСЃРєРѕР»СЊРєРёРјРё СѓСЃС‚СЂРѕР№СЃС‚РІР°РјРё РїРѕРґРєР»СЋС‡РёС‚Рµ Firebase: РґРµРјРѕ-СЂРµР¶РёРј СЃРёРЅС…СЂРѕРЅРёР·РёСЂСѓРµС‚СЃСЏ С‚РѕР»СЊРєРѕ РІ СЌС‚РѕРј Р±СЂР°СѓР·РµСЂРµ.' : /localhost|127\.0\.0\.1/.test(publicOrigin) ? 'Р­С‚РѕС‚ QR РІРµРґС‘С‚ РЅР° Р°РґСЂРµСЃ РєРѕРјРїСЊСЋС‚РµСЂР°. РџРѕСЃР»Рµ РїСѓР±Р»РёРєР°С†РёРё СЃР°Р№С‚Р° Р·РґРµСЃСЊ Р±СѓРґРµС‚ РѕР±С‰РёР№ РёРЅС‚РµСЂРЅРµС‚-Р°РґСЂРµСЃ.' : ''
  if (!session) return <main className="host-page"><header className="topbar"><div><p className="eyebrow">Р’Р•Р”РЈР©РР™ В· Р–РР’РђРЇ РЎР•РЎРЎРРЇ</p><h2>Р”РёР°РіРЅРѕСЃС‚РёРєР° Р°С‚РјРѕСЃС„РµСЂС‹ РјРѕР»РѕРґС‘Р¶Рё</h2></div><span className={`status ${firebaseReady ? '' : 'demo'}`}>{firebaseReady ? 'Р­Р¤РР  РђРљРўРР’Р•Рќ' : 'Р”Р•РњРћ-Р Р•Р–РРњ'}</span></header><Glass className="start-panel"><h1>Р“РѕС‚РѕРІС‹ РЅР°С‡Р°С‚СЊ?</h1><p>РЎРѕР·РґР°Р№С‚Рµ РєРѕРјРЅР°С‚Сѓ, РїРѕРєР°Р¶РёС‚Рµ QR-РєРѕРґ СѓС‡Р°СЃС‚РЅРёРєР°Рј Рё РЅР°С‡РЅРёС‚Рµ, РєРѕРіРґР° РІСЃРµ РїРѕРґРєР»СЋС‡Р°С‚СЃСЏ.</p><Button disabled={busy} onClick={create}>{busy ? 'РЎРѕР·РґР°С‘РјвЂ¦' : 'РЎРѕР·РґР°С‚СЊ СЃРµСЃСЃРёСЋ'}</Button></Glass></main>
  return <main className="host-shell"><aside className="host-menu"><div className="brand"><span>вњ¦</span><b>РђС‚РјРѕСЃС„РµСЂР°</b><small>РїР°РЅРµР»СЊ РІРµРґСѓС‰РµРіРѕ</small></div><nav>{menu.map(([id, label, icon]) => <button key={id} className={tab === id ? 'selected' : ''} onClick={() => setTab(id)}><span>{icon}</span>{label}</button>)}</nav><div className="menu-room"><small>РђРљРўРР’РќРђРЇ РљРћРњРќРђРўРђ</small><b>{room}</b><span>{participants.length} РёР· {session.maxParticipants} СѓС‡Р°СЃС‚РЅРёРєРѕРІ</span></div></aside><section className="host-content"><header className="host-header"><div><p className="eyebrow">РЎР•РЎРЎРРЇ В· {room}</p><h1>{tab === 'overview' ? 'РЈРїСЂР°РІР»РµРЅРёРµ СЃРµСЃСЃРёРµР№' : menu.find(item => item[0] === tab)?.[1]}</h1></div><span className={`status ${firebaseReady ? '' : 'demo'}`}>{firebaseReady ? 'Р­Р¤РР  РђРљРўРР’Р•Рќ' : 'Р”Р•РњРћ-Р Р•Р–РРњ'}</span></header>
    {tab === 'overview' && <><div className="metrics"><Metric label="РџРѕРґРєР»СЋС‡РёР»РёСЃСЊ" value={participants.length} note={`РёР· ${session.maxParticipants} СѓС‡Р°СЃС‚РЅРёРєРѕРІ`} /><Metric label="РЎРµР№С‡Р°СЃ РѕС‚РІРµС‡Р°СЋС‚" value={answering} note="РІ СЃРІРѕС‘Рј С‚РµРјРїРµ" /><Metric label="Р—Р°РІРµСЂС€РёР»Рё" value={finished} note={allFinished ? 'РІСЃРµ РіРѕС‚РѕРІС‹' : 'Р¶РґС‘Рј Р·Р°РІРµСЂС€РµРЅРёСЏ'} /></div><div className="overview-grid"><Glass className="control-panel"><p className="eyebrow">РўР•РљРЈР©РђРЇ Р¤РђР—Рђ</p><h2>{phaseText(session.phase)}</h2><p>{session.phase === 'lobby' ? 'РџРѕРєР°Р¶РёС‚Рµ QR-РєРѕРґ. РџРѕСЃР»Рµ Р·Р°РїСѓСЃРєР° Сѓ РІР°СЃ Р°РІС‚РѕРјР°С‚РёС‡РµСЃРєРё РѕС‚РєСЂРѕРµС‚СЃСЏ РѕС‚РґРµР»СЊРЅС‹Р№ СЌРєСЂР°РЅ СЃ Р¶РёРІС‹Рј РїСЂРѕРіСЂРµСЃСЃРѕРј.' : allFinished ? 'Р’СЃРµ СѓС‡Р°СЃС‚РЅРёРєРё Р·Р°РІРµСЂС€РёР»Рё РѕС‚РІРµС‚С‹. РњРѕР¶РЅРѕ РѕС‚РєСЂС‹С‚СЊ РѕР±С‰СѓСЋ РІРёР·СѓР°Р»РёР·Р°С†РёСЋ РЅР° Р±РѕР»СЊС€РѕРј СЌРєСЂР°РЅРµ.' : 'Р­РєСЂР°РЅ РїСЂРѕРіСЂРµСЃСЃР° РѕР±Р…2469 tokens truncated…> [`Р’РѕРїСЂРѕСЃ ${index + 1}`, `РћС‚РІРµС‚ ${index + 1}`]), 'total', ...Object.values(categories)]
  const csv = [headers, ...rows].map(row => row.map(value => `"${String(value).replaceAll('"', '""')}"`).join(';')).join('\n')
  const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }))
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = `diagnostika-${session.roomId}.csv`; anchor.click(); URL.revokeObjectURL(url)
}

function Metric({ label, value, note }: { label: string; value: number; note: string }) { return <Glass className="metric"><p>{label}</p><strong>{value}</strong><small>{note}</small></Glass> }

function Join({ room }: { room: string }) {
  const [session, setSession] = useRoom(room)
  const [name, setName] = useState('')
  const [participant, setParticipant] = useState<Participant | null>(null)
  const [notice, setNotice] = useState('')
  const [saving, setSaving] = useState(false)
  const [showPersonal, setShowPersonal] = useState(false)
  useEffect(() => { const stored = localStorage.getItem(`atmosphere-participant-${room}`); if (stored) setParticipant(JSON.parse(stored)) }, [room])
  useEffect(() => { if (participant && session?.participants[participant.id]) setParticipant(session.participants[participant.id]) }, [session, participant?.id])
  const join = async () => {
    if (!room || name.trim().length < 2) return setNotice('Р’РІРµРґРёС‚Рµ РЅРёРєРЅРµР№Рј РѕС‚ 2 РґРѕ 20 СЃРёРјРІРѕР»РѕРІ.')
    const user = firebaseReady ? await ensureAuth() : null
    const p: Participant = { id: user?.uid || crypto.randomUUID(), nickname: name.trim().slice(0, 20), joinedAt: Date.now(), status: 'waiting', currentQuestionIndex: 0, answers: {} }
    try {
      if (firebaseReady) await joinSession(room, p)
      else { const demo = getDemo(room) || { roomId: room, createdAt: Date.now(), phase: 'lobby' as const, maxParticipants: 30, hostUid: 'demo-host', participants: {} }; if (Object.keys(demo.participants).length >= demo.maxParticipants) throw new Error('РљРѕРјРЅР°С‚Р° СѓР¶Рµ Р·Р°РїРѕР»РЅРµРЅР°'); setDemo({ ...demo, participants: { ...demo.participants, [p.id]: p } }) }
      localStorage.setItem(`atmosphere-participant-${room}`, JSON.stringify(p)); setParticipant(p)
    } catch (error) { setNotice(error instanceof Error ? error.message : 'РќРµ СѓРґР°Р»РѕСЃСЊ РїРѕРґРєР»СЋС‡РёС‚СЊСЃСЏ') }
  }
  const answer = async (value: Answer) => {
    if (!session || !participant || saving) return
    setSaving(true)
    const activeQuestions = session.questions?.length ? session.questions : questions
    const question = activeQuestions[participant.currentQuestionIndex]
    const nextIndex = participant.currentQuestionIndex + 1
    try {
      if (firebaseReady) await saveAnswer(room, participant, question.id, value, nextIndex, activeQuestions.length)
      else { const status: Participant['status'] = nextIndex >= activeQuestions.length ? 'finished' : 'answering'; const next: Participant = { ...participant, answers: { ...participant.answers, [question.id]: value }, currentQuestionIndex: nextIndex, status, ...(nextIndex >= activeQuestions.length ? { completedAt: Date.now() } : {}) }; const nextSession: Session = { ...session, participants: { ...session.participants, [participant.id]: next } }; setDemo(nextSession); setSession(nextSession); setParticipant(next) }
    } finally { setSaving(false) }
  }
  if (!room) return <MobileShell><h1>РќСѓР¶РµРЅ РєРѕРґ РєРѕРјРЅР°С‚С‹</h1><p>РћС‚СЃРєР°РЅРёСЂСѓР№С‚Рµ QR-РєРѕРґ РІРµРґСѓС‰РµРіРѕ, С‡С‚РѕР±С‹ РѕС‚РєСЂС‹С‚СЊ Р»РёС‡РЅСѓСЋ СЃСЃС‹Р»РєСѓ.</p></MobileShell>
  if (!participant) return <MobileShell><p className="eyebrow">РћРќР›РђР™Рќ-Р”РРђР“РќРћРЎРўРРљРђ</p><h1>РђС‚РјРѕСЃС„РµСЂР°<br />РЅР°С€РµР№ РјРѕР»РѕРґС‘Р¶Рё</h1><p>РќРёРєРЅРµР№Рј РЅСѓР¶РµРЅ С‚РѕР»СЊРєРѕ РґР»СЏ С‚РІРѕРµР№ Р»РёС‡РЅРѕР№ РєР°СЂС‚РѕС‡РєРё. Р РµР°Р»СЊРЅРѕРµ РёРјСЏ СѓРєР°Р·С‹РІР°С‚СЊ РЅРµ РѕР±СЏР·Р°С‚РµР»СЊРЅРѕ.</p><input value={name} onChange={event => setName(event.target.value)} placeholder="РќР°РїСЂРёРјРµСЂ, В«РЎРІРµС‚В»" maxLength={20} /><Button onClick={() => void join()}>РџСЂРѕРґРѕР»Р¶РёС‚СЊ</Button>{notice && <p className="notice">{notice}</p>}</MobileShell>
  if (!session || session.phase === 'lobby') return <MobileShell><p className="eyebrow">РўР« РџРћР”РљР›Р®Р§РЃРќ(Рђ)</p><h1>Р–РґС‘Рј РІРµРґСѓС‰РµРіРѕ</h1><p>РљР°Рє С‚РѕР»СЊРєРѕ РґРёР°РіРЅРѕСЃС‚РёРєР° РЅР°С‡РЅС‘С‚СЃСЏ, РїРµСЂРІС‹Р№ РІРѕРїСЂРѕСЃ РїРѕСЏРІРёС‚СЃСЏ Р·РґРµСЃСЊ Р°РІС‚РѕРјР°С‚РёС‡РµСЃРєРё.</p><div className="waiting-dot" /></MobileShell>
  const openPersonal = async () => {
    if (!participant) return
    if (firebaseReady) await markPersonalViewed(room, participant.id)
    else if (session) { const next = { ...participant, personalViewedAt: Date.now() }; const nextSession = { ...session, participants: { ...session.participants, [participant.id]: next } }; setDemo(nextSession); setSession(nextSession); setParticipant(next) }
    setShowPersonal(true)
  }
  if (participant.status === 'finished' && showPersonal) return <PersonalResult participant={participant} scores={scoreAnswers(participant.answers || {})} onBack={() => setShowPersonal(false)} />
  if (participant.status === 'finished') return <Completion participant={participant} onPersonal={() => void openPersonal()} />
  const question = questions[participant.currentQuestionIndex]
  return <MobileShell><div className="progress-label"><span>Р’РћРџР РћРЎ {participant.currentQuestionIndex + 1} РР— {questions.length}</span><span>{Math.round((participant.currentQuestionIndex / questions.length) * 100)}%</span></div><div className="progress"><i style={{ width: `${participant.currentQuestionIndex / questions.length * 100}%` }} /></div><h1 className="question">{question.title}</h1><p>Р’С‹Р±РµСЂРё РІР°СЂРёР°РЅС‚, РєРѕС‚РѕСЂС‹Р№ Р±Р»РёР¶Рµ РІСЃРµРіРѕ Рє С‚РµР±Рµ.</p><div className="options">{(['A', 'B', 'C', 'D'] as Answer[]).map(letter => <button key={letter} className="option" disabled={saving} onClick={() => void answer(letter)}><b>{letter}</b><span>{question.options[letter]}</span></button>)}</div></MobileShell>
}

function MobileShell({ children }: { children: React.ReactNode }) { return <main className="mobile-wrap"><div className="mobile-card">{children}</div></main> }
function Completion({ participant, onPersonal }: { participant: Participant; onPersonal: () => void }) {
  return <MobileShell><div className="completion-mark">вњ¦</div><p className="eyebrow">Р“РћРўРћР’Рћ</p><h1>{participant.nickname}, СЃРїР°СЃРёР±Рѕ!</h1><p>РўС‹ РѕС‚РІРµС‚РёР»(Р°) РЅР° РІСЃРµ РІРѕРїСЂРѕСЃС‹ Рё РїРѕРјРѕРі(Р»Р°) СѓРІРёРґРµС‚СЊ РѕР±С‰СѓСЋ РєР°СЂС‚РёРЅСѓ. РўРІРѕСЏ Р»РёС‡РЅР°СЏ РєР°СЂС‚РѕС‡РєР° СѓР¶Рµ РіРѕС‚РѕРІР° вЂ” РµС‘ РІРёРґРёС€СЊ С‚РѕР»СЊРєРѕ С‚С‹.</p><Button onClick={onPersonal}>РџРѕР»СѓС‡РёС‚СЊ Р»РёС‡РЅС‹Р№ СЂРµР·СѓР»СЊС‚Р°С‚</Button><div className="finish-wait"><span className="waiting-dot" /><small>РџРѕСЃР»Рµ СЌС‚РѕРіРѕ РјРѕР¶РµС€СЊ РїРѕСЃРјРѕС‚СЂРµС‚СЊ РЅР° РѕР±С‰РёР№ СЌРєСЂР°РЅ Рё РґРѕР¶РґР°С‚СЊСЃСЏ РѕСЃС‚Р°Р»СЊРЅС‹С… СѓС‡Р°СЃС‚РЅРёРєРѕРІ.</small></div></MobileShell>
}
function PersonalResult({ participant, scores, onBack }: { participant: Participant; scores: Scores; onBack: () => void }) {
  return <MobileShell><div className="personal-result" id="personal-result"><p className="eyebrow">РўР’РћРЇ Р›РР§РќРђРЇ РљРђР РўРћР§РљРђ</p><h1>{participant.nickname}, СЃРїР°СЃРёР±Рѕ</h1><p>Р­С‚Рѕ РЅРµ РѕС†РµРЅРєР° С‚РµР±СЏ. Р­С‚Рѕ Р±РµСЂРµР¶РЅР°СЏ РїРѕРґСЃРєР°Р·РєР°, РіРґРµ РјРѕР¶РЅРѕ СЂР°СЃС‚Рё РґР°Р»СЊС€Рµ.</p><div className="score-circle"><b>{scores.total}%</b><small>РѕР±С‰РёР№ РѕСЂРёРµРЅС‚РёСЂ</small></div><div className="score-list">{Object.entries(scores.categories).map(([id, value]) => <div key={id}><span>{categories[id as keyof typeof categories]}</span><strong>{value}%</strong><i><em style={{ width: `${value}%` }} /></i></div>)}</div><Glass className="tip"><b>РќРµР±РѕР»СЊС€РѕР№ С€Р°Рі</b><p>{recommendation(scores)}</p></Glass></div><div className="download-actions"><Button secondary onClick={() => printResult()}>РЎРѕС…СЂР°РЅРёС‚СЊ PDF</Button><Button secondary onClick={() => downloadPoster(participant, scores)}>РЎРєР°С‡Р°С‚СЊ PNG</Button></div><Button onClick={onBack}>Р’РµСЂРЅСѓС‚СЊСЃСЏ Рє РѕР¶РёРґР°РЅРёСЋ</Button><small>РўРІРѕСЏ РєР°СЂС‚РѕС‡РєР° РЅРµ РїРѕРєР°Р·С‹РІР°РµС‚СЃСЏ РЅР° РѕР±С‰РµРј СЌРєСЂР°РЅРµ.</small></MobileShell>
}

function printResult() { document.body.dataset.printPersonal = 'true'; window.print(); window.setTimeout(() => delete document.body.dataset.printPersonal, 500) }
function downloadPoster(participant: Participant, scores: Scores) {
  const canvas = document.createElement('canvas'); canvas.width = 1080; canvas.height = 1350
  const ctx = canvas.getContext('2d'); if (!ctx) return
  ctx.fillStyle = '#03120e'; ctx.fillRect(0, 0, canvas.width, canvas.height)
  const glow = ctx.createRadialGradient(900, 80, 0, 900, 80, 600); glow.addColorStop(0, 'rgba(30, 119, 84, .85)'); glow.addColorStop(1, 'rgba(3, 18, 14, 0)'); ctx.fillStyle = glow; ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.fillStyle = '#32ce8b'; ctx.font = '700 30px Arial'; ctx.fillText('Р”РРђР“РќРћРЎРўРРљРђ РђРўРњРћРЎР¤Р•Р Р«', 90, 110)
  ctx.fillStyle = '#eef5ee'; ctx.font = '700 68px Arial'; ctx.fillText(`${participant.nickname}, С‚РІРѕСЏ`, 90, 205); ctx.fillText('Р»РёС‡РЅР°СЏ РєР°СЂС‚РѕС‡РєР°', 90, 285)
  ctx.beginPath(); ctx.arc(540, 510, 170, 0, Math.PI * 2); ctx.fillStyle = '#123d31'; ctx.fill(); ctx.strokeStyle = '#32ce8b'; ctx.lineWidth = 2; ctx.stroke()
  ctx.fillStyle = '#eef5ee'; ctx.font = '700 100px Arial'; ctx.textAlign = 'center'; ctx.fillText(`${scores.total}%`, 540, 535); ctx.font = '400 25px Arial'; ctx.fillStyle = '#9aafa5'; ctx.fillText('РѕР±С‰РёР№ РѕСЂРёРµРЅС‚РёСЂ', 540, 582); ctx.textAlign = 'left'
  let y = 770; Object.entries(scores.categories).forEach(([id, value]) => { ctx.fillStyle = '#eef5ee'; ctx.font = '600 28px Arial'; ctx.fillText(categories[id as keyof typeof categories], 90, y); ctx.textAlign = 'right'; ctx.fillStyle = '#32ce8b'; ctx.fillText(`${value}%`, 990, y); ctx.textAlign = 'left'; ctx.fillStyle = '#0e362b'; ctx.fillRect(90, y + 22, 900, 14); ctx.fillStyle = '#32ce8b'; ctx.fillRect(90, y + 22, 900 * value / 100, 14); y += 115 })
  ctx.fillStyle = '#c8ae67'; ctx.font = '700 27px Arial'; ctx.fillText('РќР•Р‘РћР›Р¬РЁРћР™ РЁРђР“', 90, 1230); ctx.fillStyle = '#9aafa5'; ctx.font = '400 25px Arial'; wrapCanvasText(ctx, recommendation(scores), 90, 1275, 900, 35)
  const anchor = document.createElement('a'); anchor.download = `Р»РёС‡РЅР°СЏ-РєР°СЂС‚РѕС‡РєР°-${participant.nickname}.png`; anchor.href = canvas.toDataURL('image/png'); anchor.click()
}
function wrapCanvasText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth: number, lineHeight: number) { let line = ''; let top = y; text.split(' ').forEach(word => { const next = `${line}${word} `; if (ctx.measureText(next).width > maxWidth && line) { ctx.fillText(line, x, top); line = `${word} `; top += lineHeight } else line = next }); ctx.fillText(line, x, top) }

function Stage({ room }: { room: string }) {
  const [session, , connection] = useRoom(room)
  if (!room) return <main className="stage"><p className="eyebrow">Р­РљР РђРќ РџР РћР“Р Р•РЎРЎРђ</p><h1>РќСѓР¶РµРЅ РєРѕРґ РєРѕРјРЅР°С‚С‹</h1><p className="stage-caption">РћС‚РєСЂРѕР№С‚Рµ СЌС‚РѕС‚ СЌРєСЂР°РЅ РёР· РїР°РЅРµР»Рё РІРµРґСѓС‰РµРіРѕ.</p></main>
  if (!session) return <main className="stage"><div className="stage-glow" /><p className="eyebrow">Р­РљР РђРќ РџР РћР“Р Р•РЎРЎРђ</p><h1>{connection === 'error' ? 'РќРµ СѓРґР°Р»РѕСЃСЊ РїРѕРґРєР»СЋС‡РёС‚СЊСЃСЏ' : 'РџРѕРґРєР»СЋС‡Р°РµРјСЃСЏ Рє РєРѕРјРЅР°С‚Рµ'}</h1><p className="stage-caption">{connection === 'error' ? 'РџСЂРѕРІРµСЂСЊС‚Рµ РёРЅС‚РµСЂРЅРµС‚ Рё РѕС‚РєСЂРѕР№С‚Рµ СЌРєСЂР°РЅ РµС‰С‘ СЂР°Р·.' : 'Р­С‚Рѕ Р·Р°Р№РјС‘С‚ РЅРµСЃРєРѕР»СЊРєРѕ СЃРµРєСѓРЅРґ.'}</p>{connection === 'error' ? <Button secondary onClick={() => window.location.reload()}>РџРѕРІС‚РѕСЂРёС‚СЊ РїРѕРґРєР»СЋС‡РµРЅРёРµ</Button> : <div className="waiting-dot" />}</main>
  const people = Object.values(session?.participants || {})
  const activeQuestionCount = session?.questions?.length || questions.length
  const answers = people.reduce((sum, participant) => sum + Object.keys(participant.answers || {}).length, 0)
  const total = Math.max(people.length * activeQuestionCount, 1)
  const progress = Math.round(answers / total * 100)
  return <main className="stage"><div className="stage-glow" /><p className="eyebrow">Р”РРђР“РќРћРЎРўРРљРђ РђРўРњРћРЎР¤Р•Р Р« РњРћР›РћР”РЃР–Р</p><h1>{session?.phase === 'lobby' ? 'РЎРєРѕСЂРѕ РЅР°С‡РЅС‘Рј' : session?.phase === 'resultsIntro' ? 'РЎРѕР±РёСЂР°РµРј РѕР±С‰СѓСЋ РєР°СЂС‚РёРЅСѓ' : session?.phase === 'resultsReal' ? 'Р РµР·СѓР»СЊС‚Р°С‚С‹ РіРѕС‚РѕРІС‹' : session ? 'РњС‹ РёРґС‘Рј РІРјРµСЃС‚Рµ' : 'РћР¶РёРґР°РµРј РєРѕРјРЅР°С‚Сѓ'}</h1><p className="stage-caption">{session?.phase === 'lobby' ? 'РЈС‡Р°СЃС‚РЅРёРєРё РїРѕРґРєР»СЋС‡Р°СЋС‚СЃСЏ РїРѕ QR-РєРѕРґСѓ.' : session?.phase === 'live' ? 'РљР°Р¶РґС‹Р№ РѕС‚РІРµС‡Р°РµС‚ РІ СЃРІРѕС‘Рј С‚РµРјРїРµ. Р—РґРµСЃСЊ вЂ” С‚РѕР»СЊРєРѕ РѕР±С‰РёР№ РїСЂРѕРіСЂРµСЃСЃ.' : 'РЎРїР°СЃРёР±Рѕ РєР°Р¶РґРѕРјСѓ, РєС‚Рѕ РѕС‚РІРµС‚РёР» С‡РµСЃС‚РЅРѕ.'}</p><div className="stage-metrics"><Metric label="РџРѕРґРєР»СЋС‡РёР»РёСЃСЊ" value={people.length} note="СѓС‡Р°СЃС‚РЅРёРєРѕРІ" /><Metric label="РћС‚РІРµС‡Р°СЋС‚" value={people.filter(person => person.status === 'answering').length} note="РІ СЃРІРѕС‘Рј С‚РµРјРїРµ" /><Metric label="Р—Р°РІРµСЂС€РёР»Рё" value={people.filter(person => person.status === 'finished').length} note="РіРѕС‚РѕРІС‹ Рє РёС‚РѕРіСѓ" /></div><Glass className="stage-progress"><p>РћР±С‰РёР№ РїСЂРѕРіСЂРµСЃСЃ</p><strong>{answers} <small>РёР· {total} РѕС‚РІРµС‚РѕРІ</small></strong><div className="progress large"><i style={{ width: `${progress}%` }} /></div><span>{progress}%</span></Glass><small className="privacy">РќР° СЌС‚РѕРј СЌРєСЂР°РЅРµ РѕС‚РѕР±СЂР°Р¶Р°СЋС‚СЃСЏ С‚РѕР»СЊРєРѕ РѕР±С‰РёРµ С‡РёСЃР»Р°.</small></main>
}

function Results({ room }: { room: string }) {
  const [session] = useRoom(room)
  const [now, setNow] = useState(Date.now())
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 250); return () => clearInterval(timer) }, [])
  const elapsed = session?.resultsIntroStartedAt ? now - session.resultsIntroStartedAt : 0
  const showReal = session?.phase === 'resultsReal' || elapsed >= 20000
  const people = Object.values(session?.participants || {})
  const real = useMemo(() => { if (!people.length) return { communication: 84, forgiveness: 71, service: 79, care: 68, honesty: 76 }; const values = people.map(person => scoreAnswers(person.answers || {}, session?.questions || questions).categories); return Object.fromEntries(Object.keys(categories).map(key => [key, Math.round(values.reduce((sum, item) => sum + item[key as keyof typeof item], 0) / values.length)])) as Record<keyof typeof categories, number> }, [people, session?.questions])
  const shown = showReal ? real : { communication: 96, forgiveness: 94, service: 97, care: 93, honesty: 95 }
  const countdown = Math.max(0, Math.ceil((20000 - elapsed) / 1000))
  return <main className={`results ${showReal ? 'reveal' : 'intro'}`}><p className="eyebrow">РћР‘Р©РР™ Р Р•Р—РЈР›Р¬РўРђРў В· {showReal ? 'Р Р•РђР›Р¬РќР«Р• Р”РђРќРќР«Р•' : `РР”Р•РђР›Р¬РќР«Р™ РћР РР•РќРўРР  В· ${countdown} РЎР•Рљ.`}</p><h1>{showReal ? 'РќР°С€Р° РѕР±С‰Р°СЏ РєР°СЂС‚РёРЅР°' : 'РљР°РєРёРјРё РјС‹ РјРѕР¶РµРј Р±С‹С‚СЊ РІРјРµСЃС‚Рµ'}</h1>{!showReal && <div className="result-loader"><i /><span>Р§РµСЂРµР· РЅРµСЃРєРѕР»СЊРєРѕ СЃРµРєСѓРЅРґ СѓРІРёРґРёРј СЂРµР°Р»СЊРЅСѓСЋ РєР°СЂС‚РёРЅСѓ РіСЂСѓРїРїС‹</span></div>}<Glass className="result-board"><div className="big-score"><b>{Math.round(Object.values(shown).reduce((a, b) => a + b, 0) / Object.keys(categories).length)}%</b><span>РѕР±С‰РёР№ РѕСЂРёРµРЅС‚РёСЂ</span></div><div className="result-bars">{Object.entries(shown).map(([id, value]) => <div key={id}><span>{categories[id as keyof typeof categories]}</span><b>{value}%</b><i><em style={{ width: `${value}%` }} /></i></div>)}</div></Glass><p className="closing">Р›СЋР±РѕРІСЊ Рё РµРґРёРЅСЃС‚РІРѕ РЅР°С‡РёРЅР°СЋС‚СЃСЏ РЅРµ СЃ РґСЂСѓРіРёС…, Р° Р»РёС‡РЅРѕ СЃ РєР°Р¶РґРѕРіРѕ РёР· РЅР°СЃ.</p><small className="privacy">РџРѕРєР°Р·Р°РЅС‹ С‚РѕР»СЊРєРѕ Р°РіСЂРµРіРёСЂРѕРІР°РЅРЅС‹Рµ СЂРµР·СѓР»СЊС‚Р°С‚С‹ вЂ” Р±РµР· РёРјС‘РЅ Рё Р»РёС‡РЅС‹С… РѕС‚РІРµС‚РѕРІ.</small></main>
}

export default App

