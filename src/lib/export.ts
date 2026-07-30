import { categories } from '../data/questions'
import { recommendations } from './scoring'
import type { Participant, Scores } from '../types'

const wishRows = (scores: Scores) => recommendations(scores)

export function printWish(participant: Participant, scores: Scores) {
  document.getElementById('wish-print')?.remove()
  const root = document.createElement('section')
  root.id = 'wish-print'
  root.className = 'wish-print'

  const eyebrow = document.createElement('p'); eyebrow.className = 'eyebrow'; eyebrow.textContent = 'ТВОИ ПОЖЕЛАНИЯ'; root.append(eyebrow)
  const title = document.createElement('h1'); title.textContent = `${participant.nickname}, спасибо`; root.append(title)
  const intro = document.createElement('p'); intro.className = 'wish-print-intro'; intro.textContent = 'По итогам твоих ответов мы подготовили для тебя пожелания.'; root.append(intro)
  const total = document.createElement('p'); total.className = 'wish-print-total'; total.textContent = `Общий ориентир: ${scores.total}%`; root.append(total)
  const list = document.createElement('div'); list.className = 'wish-print-list'
  wishRows(scores).forEach(item => {
    const card = document.createElement('article'); card.className = 'wish-print-item'
    const heading = document.createElement('h2'); heading.textContent = `${categories[item.category]} · ${item.score}%`; card.append(heading)
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
  ctx.fillStyle = '#32ce8b'; ctx.font = '700 28px Arial'; ctx.fillText('ТВОИ ПОЖЕЛАНИЯ', 80, 100)
  ctx.fillStyle = '#eef5ee'; ctx.font = '700 64px Arial'; ctx.fillText(`${participant.nickname}, спасибо`, 80, 190)
  ctx.fillStyle = '#b7c9c0'; ctx.font = '400 24px Arial'; ctx.fillText('По итогам твоих ответов мы подготовили для тебя пожелания.', 80, 235)
  ctx.fillStyle = '#c8ae67'; ctx.font = '600 28px Arial'; ctx.fillText(`Общий ориентир: ${scores.total}%`, 80, 285)
  let y = 370
  wishRows(scores).forEach(item => {
    ctx.fillStyle = '#0b3328'; ctx.beginPath(); ctx.roundRect(60, y - 45, 1280, 190, 24); ctx.fill()
    ctx.fillStyle = '#eef5ee'; ctx.font = '700 27px Arial'; ctx.fillText(`${categories[item.category]} · ${item.score}%`, 100, y)
    ctx.fillStyle = '#b7c9c0'; ctx.font = '400 22px Arial'; wrapCanvasText(ctx, item.text, 100, y + 50, 1170, 31)
    y += 220
  })
  canvas.toBlob(blob => {
    if (!blob) return
    const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = `пожелание-${participant.nickname || 'участник'}.png`; document.body.append(anchor); anchor.click(); anchor.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }, 'image/png')
}
