import { categories } from '../data/questions'
import { recommendations } from './scoring'
import type { Participant, Scores } from '../types'

const wishRows = (scores: Scores) => recommendations(scores)

export function printWish(participant: Participant, scores: Scores) {
  document.getElementById('wish-print')?.remove()
  const root = document.createElement('section')
  root.id = 'wish-print'
  root.className = 'wish-print'

  const eyebrow = document.createElement('p'); eyebrow.className = 'eyebrow'; eyebrow.textContent = 'ТВОЁ ПЕРСОНАЛЬНОЕ ПОЖЕЛАНИЕ'; root.append(eyebrow)
  const title = document.createElement('h1'); title.textContent = `${participant.nickname}, спасибо`; root.append(title)
  const total = document.createElement('p'); total.className = 'wish-print-total'; total.textContent = `Общий ориентир: ${scores.total}%`; root.append(total)
  const list = document.createElement('div'); list.className = 'wish-print-list'
  wishRows(scores).forEach(item => {
    const card = document.createElement('article'); card.className = 'wish-print-item'
    const heading = document.createElement('h2'); heading.textContent = `${categories[item.category]} · ${item.score}%`; card.append(heading)
    const label = document.createElement('small'); label.textContent = item.label; card.append(label)
    const text = document.createElement('p'); text.textContent = item.text; card.append(text)
    list.append(card)
  })
  root.append(list)
  document.body.append(root)
  document.body.dataset.printWish = 'true'
  window.print()
  window.setTimeout(() => { delete document.body.dataset.printWish; root.remove() }, 700)
}

function wrapCanvasText(ctx: CanvasRenderingContext2D, value: string, x: number, y: number, maxWidth: number, lineHeight: number) {
  let line = ''
  for (const word of value.split(' ')) {
    const candidate = line ? `${line} ${word}` : word
    if (ctx.measureText(candidate).width > maxWidth && line) { ctx.fillText(line, x, y); y += lineHeight; line = word } else line = candidate
  }
  if (line) ctx.fillText(line, x, y)
  return y + lineHeight
}

export function downloadWishPng(participant: Participant, scores: Scores) {
  const canvas = document.createElement('canvas'); canvas.width = 1400; canvas.height = 1500
  const ctx = canvas.getContext('2d'); if (!ctx) return
  ctx.fillStyle = '#03120e'; ctx.fillRect(0, 0, canvas.width, canvas.height)
  const glow = ctx.createRadialGradient(1150, 80, 0, 1150, 80, 700); glow.addColorStop(0, 'rgba(30, 119, 84, .85)'); glow.addColorStop(1, 'rgba(3, 18, 14, 0)'); ctx.fillStyle = glow; ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.fillStyle = '#32ce8b'; ctx.font = '700 28px Arial'; ctx.fillText('ТВОЁ ПЕРСОНАЛЬНОЕ ПОЖЕЛАНИЕ', 80, 100)
  ctx.fillStyle = '#eef5ee'; ctx.font = '700 64px Arial'; ctx.fillText(`${participant.nickname}, спасибо`, 80, 190)
  ctx.fillStyle = '#c8ae67'; ctx.font = '600 28px Arial'; ctx.fillText(`Общий ориентир: ${scores.total}%`, 80, 245)
  let y = 330
  wishRows(scores).forEach(item => {
    ctx.fillStyle = '#0b3328'; ctx.beginPath(); ctx.roundRect(60, y - 45, 1280, 190, 24); ctx.fill()
    ctx.fillStyle = '#eef5ee'; ctx.font = '700 27px Arial'; ctx.fillText(`${categories[item.category]} · ${item.score}%`, 100, y)
    ctx.fillStyle = '#c8ae67'; ctx.font = '600 21px Arial'; ctx.fillText(item.label, 100, y + 34)
    ctx.fillStyle = '#b7c9c0'; ctx.font = '400 22px Arial'; wrapCanvasText(ctx, item.text, 100, y + 76, 1170, 31)
    y += 220
  })
  canvas.toBlob(blob => {
    if (!blob) return
    const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = `пожелание-${participant.nickname || 'участник'}.png`; document.body.append(anchor); anchor.click(); anchor.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }, 'image/png')
}
