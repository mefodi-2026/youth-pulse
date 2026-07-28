import { useEffect, useMemo, useState } from 'react'
import { questions } from './data/questions'
import { ensureAuth, firebaseReady, subscribeSession, updatePhase } from './lib/firebase'
import type { Participant, Session } from './types'

const demoKey = (room: string) => `atmosphere-demo-${room}`
const getDemo = (room: string) => JSON.parse(localStorage.getItem(demoKey(room)) || 'null') as Session | null
const setDemo = (session: Session) => { localStorage.setItem(demoKey(session.roomId), JSON.stringify(session)); window.dispatchEvent(new StorageEvent('storage', { key: demoKey(session.roomId) })) }

function useStageSession(room: string) {
  const [session, setSession] = useState<Session | null>(null)
  const [state, setState] = useState<'connecting' | 'ready' | 'error'>('connecting')
  useEffect(() => {
    if (!room) { setState('error'); return }
    if (!firebaseReady) {
      setSession(getDemo(room)); setState('ready')
      const sync = (event: StorageEvent) => { if (event.key === demoKey(room)) setSession(getDemo(room)) }
      window.addEventListener('storage', sync)
      return () => window.removeEventListener('storage', sync)
    }
    let active = true
    let unsubscribe: () => void = () => undefined
    setState('connecting')
    void ensureAuth().then(() => {
      if (!active) return
      unsubscribe = subscribeSession(room, value => { if (active) { setSession(value); setState('ready') } }, () => { if (active) setState('error') })
    }).catch(() => { if (active) setState('error') })
    return () => { active = false; unsubscribe() }
  }, [room])
  return [session, setSession, state] as const
}

const Metric = ({ value, label, caption }: { value: number; label: string; caption: string }) => <div className="stage-stat"><strong>{value}</strong><div><b>{label}</b><small>{caption}</small></div></div>

export function StageDashboard({ room }: { room: string }) {
  const [session, setSession, state] = useStageSession(room)
  const [opening, setOpening] = useState(false)
  const people = Object.values(session?.participants || {}) as Participant[]
  const activeQuestionCount = session?.questions?.length || questions.length
  const answered = people.reduce((sum, participant) => sum + Object.keys(participant.answers || {}).length, 0)
  const totalAnswers = Math.max(people.length * activeQuestionCount, 1)
  const finished = people.filter(person => person.status === 'finished').length
  const viewed = people.filter(person => Boolean(person.personalViewedAt)).length
  const progress = Math.round(answered / totalAnswers * 100)
  const ready = people.length > 0 && finished === people.length && viewed === people.length
  const phaseLabel = session?.phase === 'lobby' ? 'РЎРѕР±РёСЂР°РµРј СѓС‡Р°СЃС‚РЅРёРєРѕРІ' : ready ? 'Р“СЂСѓРїРїР° РіРѕС‚РѕРІР° Рє РѕР±С‰РµРјСѓ СЂРµР·СѓР»СЊС‚Р°С‚Сѓ' : 'Р–РґС‘Рј Р·Р°РІРµСЂС€РµРЅРёСЏ РґРёР°РіРЅРѕСЃС‚РёРєРё'
  const basePath = window.location.pathname.replace(/\/stage$/, '')
  const reveal = async () => {
    if (!session || !ready || opening) return
    setOpening(true)
    try {
      if (firebaseReady) {
        await updatePhase(room, 'resultsIntro')
        window.setTimeout(() => { void updatePhase(room, 'resultsReal') }, 20000)
      } else {
        const next = { ...session, phase: 'resultsIntro' as const, resultsIntroStartedAt: Date.now() }
        setDemo(next); setSession(next)
        window.setTimeout(() => { const real = { ...next, phase: 'resultsReal' as const }; setDemo(real); setSession(real) }, 20000)
      }
      window.location.assign(`${basePath}/results?room=${room}`)
    } catch { setOpening(false) }
  }

  if (!session) return <main className="stage-dashboard stage-loading"><div className="stage-light" /><p className="eyebrow">Р­РљР РђРќ РџР РћР“Р Р•РЎРЎРђ</p><h1>{state === 'error' ? 'РќРµ СѓРґР°Р»РѕСЃСЊ РїРѕРґРєР»СЋС‡РёС‚СЊСЃСЏ Рє РєРѕРјРЅР°С‚Рµ' : 'РџРѕРґРєР»СЋС‡Р°РµРјСЃСЏ Рє СЃРµСЃСЃРёРё'}</h1><p>{state === 'error' ? 'РџСЂРѕРІРµСЂСЊС‚Рµ СЃРѕРµРґРёРЅРµРЅРёРµ Рё РѕС‚РєСЂРѕР№С‚Рµ СЌРєСЂР°РЅ РµС‰С‘ СЂР°Р·.' : 'Р—Р°РіСЂСѓР¶Р°РµРј Р¶РёРІС‹Рµ РґР°РЅРЅС‹Рµ СѓС‡Р°СЃС‚РЅРёРєРѕРІвЂ¦'}</p>{state === 'error' ? <button className="stage-retry" onClick={() => window.location.reload()}>РџРѕРІС‚РѕСЂРёС‚СЊ</button> : <span className="stage-spinner" />}</main>

  return <main className="stage-dashboard"><div className="stage-light" /><header className="stage-header"><div><p className="eyebrow">Р”РРђР“РќРћРЎРўРРљРђ РђРўРњРћРЎР¤Р•Р Р« РњРћР›РћР”РЃР–Р</p><h1>{phaseLabel}</h1></div><span className={ready ? 'stage-ready' : 'stage-live'}>{ready ? 'Р’РЎРЃ Р“РћРўРћР’Рћ' : 'Р­Р¤РР  РР”РЃРў'}</span></header><section className="stage-hero-card"><div className="stage-hero-copy"><p className="eyebrow">РћР‘Р©РР™ РџР РћР“Р Р•РЎРЎ</p><strong>{progress}<small>%</small></strong><p>{finished === people.length && people.length ? 'РћС‚РІРµС‚С‹ Р·Р°РІРµСЂС€РµРЅС‹. Р–РґС‘Рј, РїРѕРєР° РєР°Р¶РґС‹Р№ РѕС‚РєСЂРѕРµС‚ Р»РёС‡РЅС‹Р№ СЂРµР·СѓР»СЊС‚Р°С‚.' : 'РЈС‡Р°СЃС‚РЅРёРєРё РѕС‚РІРµС‡Р°СЋС‚ РІ СЃРІРѕС‘Рј С‚РµРјРїРµ. Р›РёС‡РЅС‹Рµ РѕС‚РІРµС‚С‹ РЅРµ РѕС‚РѕР±СЂР°Р¶Р°СЋС‚СЃСЏ.'}</p></div><div className="stage-ring"><b>{finished}</b><span>РёР· {people.length || 'вЂ”'}<br />Р·Р°РІРµСЂС€РёР»Рё</span></div><div className="stage-progress-track"><i style={{ width: `${progress}%` }} /></div><span className="stage-progress-note">{answered} РёР· {totalAnswers} РѕС‚РІРµС‚РѕРІ</span></section><section className="stage-stats"><Metric value={people.length} label="РџРѕРґРєР»СЋС‡РёР»РёСЃСЊ" caption="СѓС‡Р°СЃС‚РЅРёРєРѕРІ РІ РєРѕРјРЅР°С‚Рµ" /><Metric value={people.filter(person => person.status === 'answering').length} label="РЎРµР№С‡Р°СЃ РѕС‚РІРµС‡Р°СЋС‚" caption="РїСЂРѕС…РѕРґСЏС‚ РґРёР°РіРЅРѕСЃС‚РёРєСѓ" /><Metric value={finished} label="Р—Р°РІРµСЂС€РёР»Рё" caption="РѕС‚РІРµС‚РёР»Рё РЅР° РІРѕРїСЂРѕСЃС‹" /><Metric value={viewed} label="РћС‚РєСЂС‹Р»Рё РєР°СЂС‚РѕС‡РєСѓ" caption="СѓРІРёРґРµР»Рё Р»РёС‡РЅС‹Р№ СЂРµР·СѓР»СЊС‚Р°С‚" /></section><section className={`stage-result-control ${ready ? 'is-ready' : ''}`}><div><p className="eyebrow">РћР‘Р©РР™ Р Р•Р—РЈР›Р¬РўРђРў</p><h2>{ready ? 'РњРѕР¶РЅРѕ РїРѕРєР°Р·С‹РІР°С‚СЊ РѕР±С‰СѓСЋ РєР°СЂС‚РёРЅСѓ' : 'Р РµР·СѓР»СЊС‚Р°С‚ РїРѕРєР° Р·Р°РєСЂС‹С‚'}</h2><p>{ready ? 'Р’СЃРµ СѓС‡Р°СЃС‚РЅРёРєРё Р·Р°РІРµСЂС€РёР»Рё РґРёР°РіРЅРѕСЃС‚РёРєСѓ Рё РѕС‚РєСЂС‹Р»Рё Р»РёС‡РЅС‹Рµ РєР°СЂС‚РѕС‡РєРё.' : `Р–РґС‘Рј: Р·Р°РІРµСЂС€РёР»Рё ${finished} РёР· ${people.length || 'вЂ”'}, Р»РёС‡РЅС‹Р№ СЂРµР·СѓР»СЊС‚Р°С‚ РѕС‚РєСЂС‹Р»Рё ${viewed} РёР· ${people.length || 'вЂ”'}.`}</p></div><button className="stage-results-button" disabled={!ready || opening} onClick={() => void reveal()}>{opening ? 'РћС‚РєСЂС‹РІР°РµРјвЂ¦' : 'РџРѕР»СѓС‡РёС‚СЊ СЂРµР·СѓР»СЊС‚Р°С‚С‹'}</button></section><p className="stage-privacy">РќР° СЌС‚РѕРј СЌРєСЂР°РЅРµ вЂ” С‚РѕР»СЊРєРѕ РѕР±С‰РёР№ С…РѕРґ СЃРµСЃСЃРёРё. РРјРµРЅР° Рё РѕС‚РІРµС‚С‹ СѓС‡Р°СЃС‚РЅРёРєРѕРІ РЅРµ РїРѕРєР°Р·С‹РІР°СЋС‚СЃСЏ.</p></main>
}
