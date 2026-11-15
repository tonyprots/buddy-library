import assert from 'node:assert/strict'
import { test } from 'node:test'
import { contextTechniques, createContextPlayer } from '../src/context-abilities.js'
import { runtimeFixture } from './support/runtime-fixture.mjs'

function fixture(id, face = 1, renderer = 'svg') {
  const core = runtimeFixture(face), { raw } = core, records = [],
    source = { tagName: id === 'hologramObject' ? 'IMG' : 'DIV', src: 'data:image/svg+xml,%3Csvg/%3E' },
    entry = contextTechniques.find(item => item.id === id), bounds = id === 'peekCard' || id === 'perchRead'
      ? [820, 430, 1070, 590] : [130, 180, 460, 230],
    fact = { id: 'source-1', kind: entry.contextKinds[0], text: id === 'thinkNumber' ? '−18 %' : 'Память команды', concept: 'memory' }
  let selection = { fact, element: source, bounds }
  const plat = { kind: 'plat', x1: 820, x2: 1070, y: 430, rad: 8, spans: [[832, 1058]] }
  raw.W.plats = [plat]
  raw.W.walls = [{ x: 820, side: -1, top: 430, bottom: 590, gap: 90, h: 250, footX: 808, topX: 838, plat }]
  raw.tools.registerPropBuilders = () => 1
  raw.tools.prop3 = (name, update) => { const state = { ping: true }; records.push({ name, update, state, params: null }); return state }
  const player = createContextPlayer({ ...raw, renderer }, { host: core.host, context: () => selection }),
    start = () => { const action = player.create(id); assert.ok(action); raw.begin(action); return action },
    advance = (seconds, each, fps = 60) => {
      for (let frame = 0; frame < Math.ceil(seconds * fps); frame++) {
        raw.step(1 / fps, fps)
        for (const record of records) if (!record.state.done) record.params = record.update(record.state, raw.B.kk)
        each?.()
      }
    }, layers = () => {
      const result = [], visit = node => { if (node.getAttribute?.('data-buddy-context-layer') != null) result.push(node)
        for (const child of node.children || []) visit(child) }
      visit(core.host)
      return result
    }
  return { ...core, player, records, start, advance, entry, layers, plat,
    selection: value => { selection = value }, source: () => selection,
    close() { player.destroy(); core.close() } }
}

test('refresh контекстного номера допускает tiny measured geometry и сохраняет exact semantics', () => {
  for (const [delta, changed] of [[.002, false], [.009, false], [.011, true]]) {
    const f = fixture('thinkNumber')
    try {
      f.source().fact.target = { x: 295, y: 205, width: 330, height: 50 }
      const action = f.start()
      f.source().bounds[0] += delta; f.source().fact.target.height += delta
      assert.equal(f.player.refresh(), changed)
      if (!changed) assert.equal(f.raw.B.act, action)
    } finally { f.close() }
  }
  for (const change of [s => { s.fact.target.height += .011 }, s => { s.fact.value += 1e-9 },
    s => { s.fact.text += '!' }, s => { s.element = { ...s.element } }]) {
    const f = fixture('thinkNumber')
    try {
      Object.assign(f.source().fact, { value: 1, target: { x: 295, y: 205, width: 330, height: 50 } })
      f.start(); change(f.source())
      assert.equal(f.player.refresh(), true)
    } finally { f.close() }
  }
})

test('контекстные метаданные неизменяемы и используют один набор семи IDs', () => {
  assert.equal(contextTechniques.length, 7)
  assert.equal(new Set(contextTechniques.map(item => item.id)).size, 7)
  assert.ok(Object.isFrozen(contextTechniques))
  for (const entry of contextTechniques) {
    assert.ok(Object.isFrozen(entry) && Object.isFrozen(entry.contextKinds) && Object.isFrozen(entry.tags))
    assert.equal(entry.requires, 'floor')
    assert.ok(entry.duration > 0 && entry.duration < 15)
  }
})

test('семь постановок проходят в обе стороны, завершаются на полу и убирают только свой слой', () => {
  for (const entry of contextTechniques) for (const face of [-1, 1]) {
    const f = fixture(entry.id, face)
    try {
      const foreign = f.raw.tools.mk('g', { 'data-foreign': 'keep' }), action = f.start(), initialBounds = [...action.canvasBounds]
      let seenLayer = false, visitedCard = false, maxJump = 0, previous = [f.raw.B.x, f.raw.B.y]
      f.advance(entry.duration + .3, () => {
        const b = f.raw.B
        assert.ok([b.x, b.y, b.yaw].every(Number.isFinite))
        for (const key of ['sf', 'sa', 'ef', 'ea', 'hf', 'ha', 'kf', 'ka', 'af'])
          assert.ok(b.pose[key].every(Number.isFinite), `${entry.id}: ${key}`)
        seenLayer ||= f.layers().length > 0
        visitedCard ||= b.surf === f.plat
        maxJump = Math.max(maxJump, Math.hypot(b.x - previous[0], b.y - previous[1])); previous = [b.x, b.y]
      })
      assert.ok(seenLayer, entry.id + ': собственный SVG слой действительно создан')
      assert.equal(f.layers().length, 0, entry.id + ': слой удалён')
      assert.equal(f.raw.B.mode, 'ground'); assert.equal(f.raw.B.surf, f.raw.W.floor)
      assert.equal(f.raw.B.act.name, 'idle'); assert.ok(foreign.parentNode)
      assert.deepEqual(action.canvasBounds, initialBounds)
      if (entry.id === 'perchRead') assert.ok(visitedCard, 'Персонаж действительно побывал на выбранной карточке')
      if (entry.id === 'peekCard' || entry.id === 'perchRead') assert.ok(maxJump < 9, `${entry.id}: нет телепортаций, скачок ${maxJump}`)
      assert.equal(f.records.length, 0, 'SVG fallback не создаёт скрытые 3D props')
    } finally { f.close() }
  }
})

test('peek и чтение проходят все стыки при 60 Hz без рывков реальных кистей и стоп в обе стороны', () => {
  for (const id of ['peekCard', 'perchRead']) for (const face of [-1, 1]) {
    const f = fixture(id, face)
    try {
      f.start()
      let previous, priorPose, maxHand = 0, maxFoot = 0, maxAngle = 0
      f.advance(f.entry.duration + .3, () => {
        const b = f.raw.B, project = p => [
          b.x + (p[0] * Math.cos(b.yaw) - p[2] * Math.sin(b.yaw)) * f.raw.tools.S * b.scale,
          b.y + p[1] * f.raw.tools.S * b.scale
        ], hands = b.kk.arms.map(arm => project(arm.hand)),
          feet = b.kk.legs.flatMap(leg => [project(leg.heel), project(leg.toe)]), points = [...hands, ...feet]
        if (previous) points.forEach((point, i) => {
          const delta = Math.hypot(...point.map((value, axis) => value - previous[i][axis]))
          if (i < 2) maxHand = Math.max(maxHand, delta)
          else maxFoot = Math.max(maxFoot, delta)
        })
        if (priorPose) for (const key of ['sf', 'sa', 'ef', 'ea', 'hf', 'kf']) b.pose[key].forEach((value, i) => {
          const delta = Math.abs(value - priorPose[key][i]) % 360
          maxAngle = Math.max(maxAngle, Math.min(delta, 360 - delta))
        })
        previous = points
        priorPose = Object.fromEntries(['sf', 'sa', 'ef', 'ea', 'hf', 'kf'].map(key => [key, [...b.pose[key]]]))
        if (id === 'peekCard' && b.act.t >= 3.8 && b.act.t <= 5.5) for (const hand of hands) {
          assert.ok(Math.abs(hand[1] - f.plat.y) < 3, 'Ладонь удерживает верхнюю кромку')
          assert.ok(hand[0] > f.plat.x1 && hand[0] < f.plat.x2, 'Ладонь остаётся над карточкой')
        }
        if (id === 'perchRead' && b.act.t >= 5.5 && b.act.t <= 7.5)
          assert.ok(Math.abs(Math.max(...feet.map(point => point[1])) - f.plat.y) < .1, 'Стопы опираются на карточку при чтении')
      })
      assert.ok(maxHand < 6, `${id} face ${face}: кисть ${maxHand}px за 1/60 с`)
      assert.ok(maxFoot < 6, `${id} face ${face}: стопа ${maxFoot}px за 1/60 с`)
      assert.ok(maxAngle < 12, `${id} face ${face}: угол ${maxAngle}° за 1/60 с`)
      assert.equal(f.raw.B.surf, f.raw.W.floor)
      assert.equal(f.raw.B.act.name, 'idle')
      assert.equal(f.layers().length, 0)
    } finally { f.close() }
  }
})

test('точное число с единицей действительно видно в крупном SVG облачке', () => {
  const f = fixture('thinkNumber')
  try {
    f.start(); f.advance(3)
    const layer = f.layers()[0], text = layer.children.flatMap(node => node.children || []).find(node => node.tagName === 'TEXT')
    assert.ok(+layer.getAttribute('opacity') > .9)
    assert.equal(text.textContent, '−18 %')
    assert.ok(+text.getAttribute('font-size') >= 20)
    assert.ok(layer.children.find(node => node.children?.includes(text)).getAttribute('transform').includes('scale(1)'))
  } finally { f.close() }
})

test('рамка крупного плана включает видимый текст и проекцию, исключая удалённый источник', () => {
  for (const id of ['thinkNumber', 'hologramKeyword', 'hologramObject']) for (const face of [-1, 1]) {
    const f = fixture(id, face)
    try {
      const action = f.start()
      assert.equal(action.detailBounds(), null, 'До появления детали рамки нет')
      f.advance(4)
      const frame = action.detailBounds(), b = f.raw.B
      assert.ok(frame?.every(Number.isFinite))
      assert.ok(frame[0] < frame[2] && frame[1] < frame[3])
      const sourceX = (f.source().bounds[0] + f.source().bounds[2]) / 2
      assert.ok(sourceX < frame[0] || sourceX > frame[2], 'Удалённый источник не входит в локальный крупный план: ' + JSON.stringify({ id, face, frame }))
      if (id === 'thinkNumber') {
        const x = b.x + b.face * 30, y = b.y - 58
        assert.ok(frame[0] <= x - 75 && frame[2] >= x + 75)
        assert.ok(frame[1] < y - 50 && frame[3] > y + 32, 'Вместились верх и хвост облачка со штрихом')
      } else {
        const ci = face > 0 ? 0 : 1, hand = b.kk.arms[ci].hand,
          projection = id === 'hologramKeyword' ? f.layers()[0].children.find(node => node.children?.some(child => child.getAttribute('data-context-concept'))) : null,
          x = projection ? Number(projection.getAttribute('transform').match(/translate\(([-\d.e]+)/u)[1])
            : b.x + (hand[0] * Math.cos(b.yaw) - hand[2] * Math.sin(b.yaw)) * f.raw.tools.S * b.scale,
          y = b.y + hand[1] * f.raw.tools.S * b.scale - 8
        assert.ok(frame[0] < x - 48 && frame[2] > x + 48)
        assert.ok(frame[1] < y - (id === 'hologramKeyword' ? 98 : 72))
        assert.ok(frame[3] > y)
      }
      f.player.reset()
      assert.equal(action.detailBounds(), null, 'При отмене исчезает и рамка детали')
    } finally { f.close() }
  }
})

test('ноутбук опирается на колени, а обе кисти работают по клавиатуре', () => {
  for (const face of [-1, 1]) {
    const f = fixture('laptopNotes', face, 'webgl')
    try {
      f.start(); f.advance(3.5)
      const record = f.records.find(item => item.name === 'contextLaptop'), p = record.params, k = f.raw.B.kk,
        knees = k.legs[0].knee.map((value, i) => (value + k.legs[1].knee[i]) / 2)
      assert.equal(p.text, 'Память команды'); assert.equal(p.open, 1); assert.equal(p.typing, 1)
      assert.ok(Math.abs(p.at[0] - knees[0]) < .1 && Math.abs(p.at[1] - knees[1] + 2) < .1)
      for (const arm of k.arms) {
        assert.ok(Math.abs(arm.hand[0] - p.at[0]) < 5)
        assert.ok(Math.abs(arm.hand[1] - (p.at[1] - 1.3)) < 1.5, 'Кисть у клавиш, а не в воздухе')
        assert.ok(Math.abs(arm.hand[2]) < 8)
        const local = [(arm.hand[2] - p.at[2]) / p.k, -(arm.hand[1] - p.at[1]) / p.k, -(arm.hand[0] - p.at[0]) / p.k],
          keys = Array.from({ length: 44 }, (_, n) => [-26 + (n % 11) * 5.2, 3.25, -12 + Math.floor(n / 11) * 5.1]),
          nearest = Math.min(...keys.map(key => Math.hypot(...key.map((value, i) => value - local[i])) * p.k))
        assert.ok(nearest < .75, `Кисть в ${nearest.toFixed(3)} от реальной клавиши с учётом k/dir`)
      }
      f.advance(3.2); assert.ok(record.params.open < .1, 'Экран закрывается перед уборкой')
      f.advance(2); assert.equal(record.state.done, true)
    } finally { f.close() }
  }
})

test('в SVG восемь понятий имеют разные силуэты, а точное слово сохраняется', () => {
  const shapes = new Set()
  for (const concept of ['memory', 'target', 'team', 'chain', 'link', 'cloud', 'rules', 'search']) {
    const f = fixture('hologramKeyword')
    try {
      const old = f.source(); f.selection({ ...old, fact: { ...old.fact, concept } })
      f.start(); f.advance(3)
      const layer = f.layers()[0], projection = layer.children.find(node => node.children?.some(child => child.getAttribute('data-context-concept') === concept)),
        path = projection.children.find(child => child.getAttribute('data-context-concept') === concept)
      assert.ok(projection.getAttribute('transform').includes('scale('))
      shapes.add(path.getAttribute('d'))
      assert.ok(projection.children.some(child => child.tagName === 'TEXT' && child.textContent === 'Память команды'))
    } finally { f.close() }
  }
  assert.equal(shapes.size, 8)
})

test('объёмный образ разворачивается к зрителю в обе стороны и помещается в исходный резерв', () => {
  for (const face of [-1, 1]) {
    const f = fixture('hologramKeyword', face, 'webgl')
    try {
      const action = f.start(); f.advance(3.5)
      const p = f.records.find(item => item.name === 'contextConcept').params,
        centre = [f.raw.B.x + (p.at[0] * Math.cos(f.raw.B.yaw) - p.at[2] * Math.sin(f.raw.B.yaw)) * f.raw.tools.S,
          f.raw.B.y + p.at[1] * f.raw.tools.S], r = 64 * f.raw.tools.S
      assert.ok(p.dir.every(Number.isFinite))
      assert.ok(Math.abs(Math.hypot(...p.dir) - 1) < 1e-8)
      assert.ok(Math.abs(p.dir[2]) > .7, 'Широкая лицевая сторона направлена в зал')
      assert.equal(p.k, 1, 'Разворот не компенсируется уменьшением предмета')
      assert.ok(centre[0] - r > action.canvasBounds[0] && centre[0] + r < action.canvasBounds[2])
      assert.ok(centre[1] - r > action.canvasBounds[1] && centre[1] + r < action.canvasBounds[3])
    } finally { f.close() }
  }
})

test('refresh карточки в воздухе очищает маску, сохраняя координату до физического падения', () => {
  const f = fixture('peekCard')
  try {
    f.host.style.clipPath = 'inset(2px)'; f.start(); f.advance(4)
    const y = f.raw.B.y
    f.selection(null); assert.equal(f.player.refresh(), true)
    assert.equal(f.host.style.clipPath, 'inset(2px)')
    assert.equal(f.raw.B.y, y); assert.equal(f.raw.B.mode, 'free')
    assert.equal(f.layers().length, 0)
  } finally { f.close() }
})

test('прерывание peekCard восстанавливает clip-path и сохраняет воздушное положение', () => {
  const f = fixture('peekCard')
  try {
    f.host.style.clipPath = 'inset(1px)'; f.start(); f.advance(4)
    assert.notEqual(f.host.style.clipPath, 'inset(1px)')
    assert.ok(f.host.style.clipPath.includes('820 430H1070V590'))
    const y = f.raw.B.y
    f.player.reset()
    assert.equal(f.host.style.clipPath, 'inset(1px)')
    assert.equal(f.layers().length, 0)
    assert.equal(f.raw.B.y, y, 'Нет телепортации на пол при отмене')
    assert.equal(f.raw.B.mode, 'free')
    f.raw.reset(); assert.equal(f.raw.B.surf, f.raw.W.floor)
  } finally { f.close() }
})

test('refresh отменяет устаревший источник событием, не читая DOM на каждом кадре', () => {
  const f = fixture('thinkNumber')
  try {
    f.start(); f.advance(2)
    assert.equal(f.player.refresh(), false)
    const old = f.source()
    f.selection({ ...old, fact: { ...old.fact, text: '−19 %' } })
    assert.equal(f.player.refresh(), true)
    assert.equal(f.layers().length, 0)
    assert.equal(f.raw.B.act.name, 'idle')
    f.advance(.2); assert.equal(f.layers().length, 0)
  } finally { f.close() }
})

test('замена картинки при тех же подписи и границах убирает устаревшую проекцию без кадровых чтений', () => {
  for (const field of ['src', 'currentSrc', 'srcset', 'sizes', 'outerHTML']) {
    const f = fixture('hologramObject'), source = f.source().element
    let reads = 0, value = field === 'outerHTML' ? '<svg><path d="M0 0H10"/></svg>' : 'old'
    if (field === 'outerHTML') source.tagName = 'SVG'
    Object.defineProperty(source, field, { configurable: true, get: () => { reads++; return value } })
    try {
      f.start()
      const initialReads = reads
      f.advance(3)
      assert.equal(reads, initialReads, `${field}: содержимое не читается на кадрах`)
      assert.equal(f.player.refresh(), false, `${field}: неизменённый источник продолжает номер`)
      value = field === 'outerHTML' ? '<svg><path d="M0 0H20"/></svg>' : 'new'
      assert.equal(f.player.refresh(), true, `${field}: новый источник отменяет прежнюю копию`)
      assert.equal(f.layers().length, 0)
      assert.equal(f.raw.B.act.name, 'idle')
      assert.equal(f.player.refresh(), false, 'Повторная очистка идемпотентна')
    } finally { f.close() }
  }
})

test('peek остаётся в одном свободном участке кромки вместе с телом и обеими ладонями', () => {
  for (const face of [-1, 1]) for (const side of [-1, 1]) {
    const f = fixture('peekCard', face)
    try {
      f.raw.W.floor.spans = [[0, 1280]]
      f.plat.spans = [[832, 870], [1000, 1058]]
      if (side > 0) f.raw.W.walls = [{ ...f.raw.W.walls[0], x: 1070, side: 1, footX: 1082, topX: 1052 }]
      f.start(); f.advance(4)
      const b = f.raw.B, span = f.plat.spans.find(([a, z]) => b.x - 12 >= a && b.x + 12 <= z)
      assert.ok(span, `Тело x=${b.x} имеет запас внутри одного участка, сторона ${side}`)
      for (const arm of b.kk.arms) {
        const x = b.x + (arm.hand[0] * Math.cos(b.yaw) - arm.hand[2] * Math.sin(b.yaw)) * f.raw.tools.S * b.scale
        assert.ok(x > span[0] + 1 && x < span[1] - 1, `Ладонь x=${x} остаётся на той же кромке`)
      }
      f.advance(6)
      assert.equal(b.surf, f.raw.W.floor)
      assert.equal(f.layers().length, 0)
    } finally { f.close() }
  }
})

test('карточка с узким доступным участком не запускает подъём через занятый промежуток', () => {
  for (const id of ['peekCard', 'perchRead']) {
    const f = fixture(id)
    try {
      f.plat.spans = [[832, 850], [1000, 1058]]
      assert.ok(f.player.can(id))
      assert.equal(f.player.create(id), null)
      assert.equal(f.layers().length, 0)
    } finally { f.close() }
  }
})

test('нет запуска без совместимого факта, достижимой кромки, пола и полного движения', () => {
  const f = fixture('perchRead')
  try {
    f.raw.W.walls = []; assert.ok(f.player.can('perchRead')); assert.equal(f.player.create('perchRead'), null)
    f.selection(null); assert.ok(f.player.can('thinkNumber'))
    assert.ok(f.player.can('unknown'))
    f.raw.B.mode = 'free'; assert.ok(f.player.can('laptopNotes'))
    f.player.destroy(); assert.ok(f.player.can('perchRead'))
  } finally { f.close() }
})

test('маска восстанавливается после канонизации path браузерным CSSOM', () => {
  const f = fixture('peekCard')
  let current = 'inset(3px)'
  Object.defineProperty(f.host.style, 'clipPath', { configurable: true,
    get: () => current, set: value => { current = String(value).replace(/M(?=\d)/g, 'M ') } })
  try {
    f.start(); f.advance(4)
    assert.ok(current.includes('M 0'))
    f.player.reset()
    assert.equal(current, 'inset(3px)')
  } finally { f.close() }
})

test('после прерывания позднее обновление старого факта не отменяет новый обычный номер', () => {
  for (const interrupt of ['run', 'begin']) {
    const f = fixture('thinkNumber')
    try {
      f.start(); f.advance(2)
      interrupt === 'run' ? f.raw.run(['wave']) : f.raw.begin(f.raw.MAKE.wave())
      const old = f.source(); f.selection({ ...old, fact: { ...old.fact, text: 'Другое число' } })
      assert.equal(f.player.refresh(), false)
      assert.equal(f.raw.B.act.name, 'wave')
      assert.equal(f.layers().length, 0)
    } finally { f.close() }
  }
})
