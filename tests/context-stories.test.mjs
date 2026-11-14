import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { test } from 'node:test'
import { storyTechniques, createStoryPlayer } from '../context-stories.js'
import { contextTechniques, createContextPlayer } from '../context-abilities.js'
import { runtimeFixture } from './support/runtime-fixture.mjs'

const allIds = ['thinkKeyword', 'compareValues', 'followChart', 'chartClimb', 'cardRoute', 'traceFlow',
  'inspectDetail', 'assembleList', 'showBeforeAfter', 'quoteIdea']

function fixture(id, face = 1, renderer = 'svg') {
  const core = runtimeFixture(face), { raw } = core, records = [], entry = storyTechniques.find(item => item.id === id) || contextTechniques.find(item => item.id === id),
    source = { tagName: id === 'hologramObject' ? 'IMG' : 'DIV', src: 'data:image/svg+xml,old' }, image = { tagName: 'IMG', src: 'data:image/svg+xml,old' },
    target = (x, y, width = 140, height = 100) => ({ x, y, width, height }),
    a = { id: 'a', text: 'До: −18 %', value: '−18 %', unit: '%', target: target(250, 300) },
    b = { id: 'b', text: 'После: +7 %', value: '+7 %', unit: '%', target: target(500, 300) },
    items = id === 'inspectDetail' ? [{ ...a, text: 'Фрагмент', id: 'image', target: target(330, 330, 260, 200) }]
      : id === 'assembleList' ? [{ ...a, text: 'Проверить источник', checked: false }, { ...b, text: 'Сохранить подпись', checked: true },
        { ...b, id: 'c', text: 'Показать пример' }] : [a, b],
    structure = { items, points: [{ x: 160, y: 390 }, { x: 240, y: 320 }, { x: 370, y: 370 }, { x: 530, y: 240 }],
      edges: [{ from: 'a', to: 'b', points: [{ x: 320, y: 300 }, { x: 430, y: 300 }] }],
      crop: { x: 260, y: 270, width: 100, height: 80 } },
    fact = { id: 'story-source', kind: entry.contextKinds[0], text: id === 'thinkKeyword' ? 'Память команды' : 'Точная формулировка — без домыслов.',
      concept: 'memory', structure },
    parts = items.map(item => ({ id: item.id, element: image, bounds: [200, 230, 460, 430] }))
  let selection = { fact, element: source, bounds: [120, 180, 600, 430], parts }
  raw.W.floor.spans = [[0, 1280]]
  if (['chartClimb', 'cardRoute', 'peekCard', 'perchRead'].includes(id)) {
    raw.W.plats = [760, 1000].map((x, i) => ({ kind: 'plat', x1: x, x2: x + 120, y: 440 + i * 30,
      spans: [[x + 12, x + 108]], rad: 8 }))
    raw.W.walls = raw.W.plats.map(plat => ({ x: plat.x1, side: -1, top: plat.y, bottom: plat.y + 120,
      gap: 100, h: raw.W.floor.y - plat.y, footX: plat.x1 - 12, topX: plat.x1 + 18, plat }))
    items.forEach((item, i) => { const plat = raw.W.plats[i]; item.target = target((plat.x1 + plat.x2) / 2, plat.y + 60, 120, 120) })
    if (id === 'peekCard' || id === 'perchRead') selection.bounds = [760, 440, 880, 560]
  }
  raw.tools.registerPropBuilders = () => 1
  raw.tools.prop3 = (name, update) => { const state = { ping: true }; records.push({ name, update, state, params: null }); return state }
  const player = (storyTechniques.includes(entry) ? createStoryPlayer : createContextPlayer)({ ...raw, renderer }, { host: core.host, context: () => selection }),
    start = () => { const action = player.create(id); assert.ok(action, `${id}: ${player.can(id)}`); raw.begin(action); return action },
    advance = (seconds, each, fps = 60) => {
      for (let frame = 0; frame < Math.round(seconds * fps); frame++) {
        raw.step(1 / fps, fps)
        for (const record of records) if (!record.state.done) record.params = record.update(record.state, raw.B.kk)
        each?.(frame)
      }
    },
    layers = () => {
      const result = [], visit = node => {
        if (node.getAttribute?.('data-buddy-story-layer') != null) result.push(node)
        for (const child of node.children || []) visit(child)
      }
      visit(core.host); return result
    },
    nodes = () => {
      const result = [], visit = node => { result.push(node); for (const child of node.children || []) visit(child) }
      for (const layer of layers()) visit(layer)
      return result
    }
  return { ...core, player, records, entry, start, advance, layers, nodes,
    selection: value => { selection = value }, source: () => selection,
    close() { player.destroy(); core.close() } }
}

test('реестр содержит десять неизменяемых историй с единым контрактом длительности', () => {
  assert.deepEqual(storyTechniques.map(item => item.id), allIds)
  assert.ok(Object.isFrozen(storyTechniques))
  for (const entry of storyTechniques) {
    assert.ok(Object.isFrozen(entry) && Object.isFrozen(entry.contextKinds) && Object.isFrozen(entry.tags))
    assert.equal(entry.requires, 'floor'); assert.equal(entry.group, 'Контекст слайда')
    assert.ok(entry.duration > 6 && entry.duration <= 25)
  }
})

test('переходы между карточками и возвращение по полу не сбрасывают голову за один кадр', () => {
  const cases = []
  for (const face of [-1, 1]) {
    const f = fixture('cardRoute', face)
    try {
      f.start()
      const path = [], row = { face, maxHeadStep: 0 }
      let prior = null
      f.advance(f.entry.duration + .4, () => {
        const b = f.raw.B, head = [b.pose.hp, b.pose.hy]
        path.push([b.t, b.x, b.y, b.mode, b.surf.kind])
        if (prior) {
          const step = Math.max(...head.map((value, i) => Math.abs(value - prior[i])))
          if (step > row.maxHeadStep) { row.maxHeadStep = step; row.at = { time: b.act.t, action: b.act.name, from: prior, to: head } }
        }
        prior = head
      }, 120)
      row.bodyPathSHA = createHash('sha256').update(JSON.stringify(path)).digest('hex')
      row.final = f.raw.B.act.name; cases.push(row)
    } finally { f.close() }
  }
  if (process.env.BUDDY_ROUTE_HEAD_REPORT) writeFileSync(process.env.BUDDY_ROUTE_HEAD_REPORT,
    JSON.stringify({ created: new Date().toISOString(), hz: 120, cases }, null, 2) + '\n')
  for (const row of cases) {
    assert.equal(row.final, 'idle')
    assert.ok(row.maxHeadStep < 3, 'Шаг головы <3° при120Hz. ' + JSON.stringify(row))
  }
})

test('двадцать новых траекторий 60 Hz непрерывны; четырнадцать прежних записаны для сравнения', () => {
  const trajectories = []
  for (const id of [...allIds, ...contextTechniques.map(entry => entry.id)]) for (const face of [-1, 1]) {
    const f = fixture(id, face)
    try {
      const start = [f.raw.B.x, f.raw.B.y], action = f.start(), foreign = f.raw.tools.mk('g', { 'data-foreign': 'keep' }),
        visited = new Set(), initialBounds = [...action.canvasBounds], distances = []
      let previous = [f.raw.B.x, f.raw.B.y], maxPoseJump = 0, maxPoseAt, priorPose, priorHands, priorFeet,
        maxHandStep = 0, maxFootStep = 0, maxHandAt, maxFootAt, visible = false, detail = false
      f.advance(f.entry.duration + .4, frame => {
        const b = f.raw.B, p = b.pose, distance = Math.hypot(b.x - previous[0], b.y - previous[1])
        distances.push(distance); previous = [b.x, b.y]
        assert.ok([b.x, b.y, b.yaw].every(Number.isFinite), id)
        for (const key of ['sf', 'sa', 'ef', 'ea', 'hf', 'ha', 'kf', 'ka', 'af']) assert.ok(p[key].every(Number.isFinite), `${id} ${key}`)
        if (priorPose) for (const key of ['sf', 'sa', 'ef', 'ea', 'hf', 'kf']) p[key].forEach((v, i) => {
          const delta = Math.abs(v - priorPose[key][i]) % 360
          if (Math.min(delta, 360 - delta) > maxPoseJump) { maxPoseJump = Math.min(delta, 360 - delta); maxPoseAt = { frame, key, i, from: priorPose[key][i], to: v } }
        })
        priorPose = Object.fromEntries(['sf', 'sa', 'ef', 'ea', 'hf', 'kf'].map(key => [key, [...p[key]]]))
        const project = p => [b.x + (p[0] * Math.cos(b.yaw) - p[2] * Math.sin(b.yaw)) * f.raw.tools.S * b.scale,
          b.y + p[1] * f.raw.tools.S * b.scale], hands = b.kk.arms.map(arm => project(arm.hand)),
          feet = b.kk.legs.flatMap(leg => [project(leg.heel), project(leg.toe)])
        if (priorHands) hands.forEach((p, i) => {
          const step = Math.hypot(p[0] - priorHands[i][0], p[1] - priorHands[i][1])
          if (step > maxHandStep) { maxHandStep = step; maxHandAt = { frame, time: frame / 60, i, from: priorHands[i], to: p, actor: [b.x, b.y], surface: b.surf?.kind } }
        })
        if (priorFeet) feet.forEach((p, i) => {
          const step = Math.hypot(p[0] - priorFeet[i][0], p[1] - priorFeet[i][1])
          if (step > maxFootStep) { maxFootStep = step; maxFootAt = { frame, time: frame / 60, i, from: priorFeet[i], to: p, actor: [b.x, b.y], surface: b.surf?.kind } }
        })
        priorHands = hands; priorFeet = feet
        if (b.surf?.kind === 'plat') visited.add(b.surf)
        visible ||= f.layers().length > 0
        const box = action.detailBounds()
        detail ||= !!box
        if (box) assert.ok(box.every(Number.isFinite) && box[2] > box[0] && box[3] > box[1])
      })
      if (allIds.includes(id)) {
      assert.ok(visible, id + ': отдельный SVG результат был создан')
      assert.ok(Math.max(...distances) < 9, `${id} face ${face}: скачок позиции ${Math.max(...distances)}`)
      assert.ok(maxPoseJump < 12, `${id} face ${face}: скачок угла ${maxPoseJump} ${JSON.stringify(maxPoseAt)}`)
      assert.ok(maxHandStep < 7, `${id} face ${face}: скачок кисти ${maxHandStep}px за 1/60с`)
      assert.ok(maxFootStep < 9, `${id} face ${face}: скачок стопы ${maxFootStep}px за 1/60с`)
      assert.equal(f.raw.B.mode, 'ground', id); assert.equal(f.raw.B.surf, f.raw.W.floor)
      assert.ok(Math.abs(f.raw.B.x - start[0]) < 3, `${id}: возвращается по исходной координате ${start[0]} → ${f.raw.B.x}`)
      assert.equal(f.layers().length, 0); assert.ok(foreign.parentNode)
      assert.deepEqual(action.canvasBounds, initialBounds); assert.equal(action.detailBounds(), null)
      if (id === 'chartClimb' || id === 'cardRoute') assert.equal(visited.size, 2, 'На обеих исходных опорах была остановка')
      else assert.ok(detail, id + ': содержимое входит в detailBounds')
      }
      trajectories.push({ id, generation: allIds.includes(id) ? 'new' : 'baseline', face, fps: 60, seconds: f.entry.duration, maxPositionStep: Math.max(...distances),
        maxJointAngleStep: maxPoseJump, maxJointAt: maxPoseAt, maxHandStep, maxHandAt, maxFootStep, maxFootAt, visitedPlatforms: visited.size, final: f.raw.B.act.name })
    } finally { f.close() }
  }
  if (process.env.STORY_TRAJECTORY_REPORT) writeFileSync(process.env.STORY_TRAJECTORY_REPORT,
    JSON.stringify({ date: new Date().toISOString(), sources: Object.fromEntries(['context-stories.js', 'context-abilities.js'].map(file =>
      [file, createHash('sha256').update(readFileSync(new URL('../' + file, import.meta.url))).digest('hex')])), trajectories }, null, 2) + '\n')
})

test('числа, цитата и состояние списка сохраняются буквально без автоматических оценок', () => {
  for (const id of ['compareValues', 'quoteIdea', 'assembleList', 'thinkKeyword']) {
    const f = fixture(id)
    try {
      f.start(); f.advance(5)
      const texts = f.nodes().filter(node => node.tagName === 'TSPAN').map(node => node.textContent).join('')
      if (id === 'compareValues') { assert.ok(texts.includes('−18 %')); assert.ok(texts.includes('+7 %')) }
      if (id === 'quoteIdea' || id === 'thinkKeyword') assert.ok(texts.includes(f.source().fact.text))
      if (id === 'assembleList') {
        for (const item of f.source().fact.structure.items) assert.ok(texts.includes(item.text))
        const marks = f.nodes().filter(node => node.tagName === 'PATH' && node.getAttribute('d')?.includes('l4 4 6-8'))
        assert.equal(marks.length, 1, 'Галочка только у checked:true исходного списка')
      }
      assert.ok(!/успех|лучше|победа|отлично/i.test(texts))
    } finally { f.close() }
  }
})

test('световой курсор следует исходному графику и явным связям без новых рёбер', () => {
  for (const id of ['followChart', 'traceFlow']) {
    const f = fixture(id, 1, 'webgl')
    try {
      f.start(); f.advance(4)
      const source = f.source().fact.structure, lines = f.nodes().filter(node => node.tagName === 'POLYLINE'),
        expected = id === 'followChart' ? [source.points] : source.edges.map(edge => edge.points)
      assert.deepEqual(lines.map(node => node.getAttribute('points')), expected.map(path => path.map(p => `${p.x},${p.y}`).join(' ')))
      const record = f.records.find(r => r.name === 'contextStylus')
      assert.ok(record?.params.fade > 0)
      assert.deepEqual(record.params.at, f.raw.B.kk.arms[0].hand, 'Указка закреплена в реальной кисти')
      const cursor = f.nodes().find(node => node.tagName === 'CIRCLE'), x = +cursor.getAttribute('cx'), y = +cursor.getAttribute('cy')
      assert.ok(expected.flat().some(p => Math.hypot(p.x - x, p.y - y) < 250))
    } finally { f.close() }
  }
})

test('traceFlow плавно перенаводится между двумя и тремя несмежными связями в обе стороны', () => {
  const cases = []
  for (const edgeCount of [2, 3]) for (const face of [-1, 1]) {
    const f = fixture('traceFlow', face, 'webgl')
    try {
      const source = f.source(), a = { x: 100, y: 100 }, b = { x: 150, y: 150 }, c = { x: 1200, y: 650 },
        edges = [{ from: 'a', to: 'b', points: [a, b] }, { from: 'c', to: 'b', points: [c, b] },
          { from: 'b', to: 'c', points: [b, c] }].slice(0, edgeCount)
      source.fact.structure.items = [a, b, c].map((p, i) => ({ id: ['a', 'b', 'c'][i], text: ['A', 'B', 'C'][i],
        target: { ...p, width: 20, height: 20 } }))
      source.fact.structure.edges = edges
      assert.equal(f.player.can('traceFlow'), null)
      f.start()
      let previous, maxAngle = 0, maxAt, maxHand = 0, maxYaw = 0, maxCursor = 0, maxVisibleCursor = 0, hiddenRedirect = false
      f.advance(f.entry.duration + .2, frame => {
        const nodes = f.nodes(), cursor = nodes.find(node => node.tagName === 'CIRCLE'),
          beam = nodes.find(node => node.tagName === 'PATH' && node.getAttribute('stroke') === '#248655'), b = f.raw.B,
          hand = b.kk.arms[face > 0 ? 0 : 1].hand,
          current = { face: b.face, yaw: b.yaw, hand: [b.x + (hand[0] * Math.cos(b.yaw) - hand[2] * Math.sin(b.yaw)) * f.raw.tools.S,
            b.y + hand[1] * f.raw.tools.S], pose: Object.fromEntries(['sf', 'sa', 'ef', 'ea', 'hf', 'kf'].map(key => [key, [...b.pose[key]]])),
            cursor: cursor ? [+cursor.getAttribute('cx'), +cursor.getAttribute('cy')] : null, visible: cursor && +cursor.getAttribute('opacity') > .01 }
        if (previous) {
          for (const key of Object.keys(current.pose)) for (const [i, angle] of current.pose[key].entries()) {
            const delta = Math.abs(angle - previous.pose[key][i]) % 360
            if (Math.min(delta, 360 - delta) > maxAngle) { maxAngle = Math.min(delta, 360 - delta); maxAt = { frame, key, i, from: previous.pose[key][i], to: angle } }
          }
          maxHand = Math.max(maxHand, Math.hypot(current.hand[0] - previous.hand[0], current.hand[1] - previous.hand[1]))
          maxYaw = Math.max(maxYaw, Math.abs(current.yaw - previous.yaw) * 180 / Math.PI)
          assert.equal(current.face, face, 'Переход между рёбрами не переключает сторону тела')
          if (current.cursor && previous.cursor) {
            const distance = Math.hypot(current.cursor[0] - previous.cursor[0], current.cursor[1] - previous.cursor[1])
            maxCursor = Math.max(maxCursor, distance)
            if (current.visible && previous.visible) maxVisibleCursor = Math.max(maxVisibleCursor, distance)
            if (!current.visible && distance > 5) {
              hiddenRedirect = true; assert.equal(+beam.getAttribute('opacity'), 0, 'Невидимое перенаведение не рисует нового ребра')
            }
          }
        }
        previous = current
      })
      assert.ok(hiddenRedirect)
      assert.ok(maxAngle < 12, `edges=${edgeCount}, face=${face}: угол ${maxAngle} ${JSON.stringify(maxAt)}`)
      assert.ok(maxHand < 7, `edges=${edgeCount}, face=${face}: кисть ${maxHand}`)
      assert.ok(maxYaw < 3, `edges=${edgeCount}, face=${face}: yaw ${maxYaw}`)
      assert.ok(maxCursor < 60 && maxVisibleCursor < 60, 'Нет мгновенного перехода курсора через слайд')
      assert.equal(f.layers().length, 0)
      cases.push({ edgeCount, face, maxAngle, maxHand, maxYaw, maxCursor, maxVisibleCursor })
      f.raw.reset()
      for (const count of [4, 16]) {
        source.fact.structure.edges = Array.from({ length: count }, (_, i) => edges[i % edges.length])
        assert.ok(f.player.can('traceFlow'), `${count} ребра не сжимаются в короткую постановку`)
        assert.equal(f.player.create('traceFlow'), null)
      }
    } finally { f.close() }
  }
  if (process.env.STORY_FLOW_REPORT) writeFileSync(process.env.STORY_FLOW_REPORT, JSON.stringify({ date: new Date().toISOString(),
    sourceSha: createHash('sha256').update(readFileSync(new URL('../context-stories.js', import.meta.url))).digest('hex'), cases }, null, 2) + '\n')
})

test('точный crop и пара изображений используют исходный media, не условные заглушки', () => {
  for (const id of ['inspectDetail', 'showBeforeAfter']) {
    const f = fixture(id)
    try {
      f.start(); f.advance(4)
      const images = f.nodes().filter(node => node.tagName === 'IMAGE')
      assert.equal(images.length, id === 'inspectDetail' ? 1 : 2)
      assert.ok(images.every(node => node.getAttribute('href') === 'data:image/svg+xml,old'))
      if (id === 'inspectDetail') assert.ok(f.nodes().some(node => node.getAttribute('viewBox') === '260 270 100 80'))
      if (id === 'inspectDetail') {
        const viewport = f.nodes().find(node => node.getAttribute('viewBox') === '260 270 100 80')
        assert.ok(+viewport.getAttribute('width') / 100 >= 1.5, 'Фрагмент реально увеличен, а не уменьшен в рамке')
      }
    } finally { f.close() }
  }
})

test('смена source, part image, структуры и удаление отменяют старую историю событийно, без DOM-чтений в кадрах', () => {
  for (const id of allIds) {
    const f = fixture(id)
    let reads = 0
    Object.defineProperty(f.source().parts[0].element, 'src', { configurable: true, get: () => { reads++; return 'data:image/svg+xml,old' } })
    try {
      f.start(); const baseline = reads
      f.advance(3); assert.equal(reads, baseline)
      assert.equal(f.player.refresh(), false)
      const old = f.source()
      f.selection({ ...old, fact: { ...old.fact, text: old.fact.text + ' Изменено' } })
      assert.equal(f.player.refresh(), true)
      assert.equal(f.layers().length, 0)
      assert.equal(f.player.refresh(), false)
    } finally { f.close() }
  }
  const f = fixture('inspectDetail')
  try {
    f.start(); f.advance(3)
    f.source().parts[0].element.src = 'data:image/svg+xml,new'
    assert.equal(f.player.refresh(), true)
    assert.equal(f.layers().length, 0)
  } finally { f.close() }
})

test('float-шум рескана сохраняет историю, реальные points/crop/labels/checked и parts отменяют', () => {
  for (const [id, change] of [
    ['followChart', source => { source.fact.structure.points[1].x += 2 }],
    ['inspectDetail', source => { source.fact.structure.crop.width += 5 }],
    ['compareValues', source => { source.fact.structure.items[0].label = 'Другая подпись' }],
    ['assembleList', source => { source.fact.structure.items[0].checked = true }],
    ['showBeforeAfter', source => { source.parts[0].element = { ...source.parts[0].element } }]
  ]) {
    const f = fixture(id)
    try {
      f.start(); f.advance(3)
      const old = f.source(), fact = JSON.parse(JSON.stringify(old.fact)),
        jitter = object => { for (const key of Object.keys(object)) object[key] += 1e-9 }
      for (const item of fact.structure.items) jitter(item.target)
      for (const point of fact.structure.points) jitter(point)
      for (const edge of fact.structure.edges) for (const point of edge.points) jitter(point)
      const updated = { ...old, fact, bounds: old.bounds.map(v => v + 1e-9),
        parts: old.parts.map(part => ({ ...part, bounds: part.bounds.map(v => v + 1e-9) })) }
      f.selection(updated)
      assert.equal(f.player.refresh(), false, id + ': субпиксельный шум не меняет источник')
      change(updated)
      assert.equal(f.player.refresh(), true, id + ': реальное изменение прекращает прежнюю историю')
      assert.equal(f.layers().length, 0)
    } finally { f.close() }
  }
})

test('quoteIdea refresh переносит границу округления и измеренный шум, но не накапливает дрейф', () => {
  for (const face of [-1, 1]) {
    const f = fixture('quoteIdea', face)
    try {
      const source = f.source(), center = 185.5625, epsilon = Number.EPSILON * center
      source.fact.target = { x: 360, y: 272.78125, width: 480, height: center + epsilon }
      source.bounds[3] = 365.5625 + epsilon
      const action = f.start()
      f.advance(1 / 60)
      source.fact.target.height = center - epsilon; source.bounds[3] = 365.5625 - epsilon
      assert.equal(f.player.refresh(), false, 'Пересечение .0005 не отменяет настоящий номер')
      assert.equal(f.raw.B.act, action)
      source.fact.target.height = center + .009; source.bounds[3] = 365.5625 + .009
      assert.equal(f.player.refresh(), false, 'Микродрейф измерения допустим')
      source.fact.target.height = center + .011
      assert.equal(f.player.refresh(), true, 'Допуск считается от исходного снимка')
    } finally { f.close() }
  }
})

test('refresh сохраняет точные числа, единицы, crop, media и авторские точки без округления', () => {
  for (const [id, change] of [
    ['quoteIdea', s => { s.fact.text += '!' }],
    ['thinkKeyword', s => { s.fact.concept = 'target' }],
    ['quoteIdea', s => { s.fact.value += 1e-9 }],
    ['compareValues', s => { s.fact.structure.items[0].value = '−18.000000001 %' }],
    ['compareValues', s => { s.fact.structure.items[0].unit = 'мс' }],
    ['inspectDetail', s => { s.fact.structure.crop.width += 1e-9 }],
    ['assembleList', s => { s.fact.structure.items[0].checked = true }],
    ['showBeforeAfter', s => { s.parts[0].media.width += 1e-9 }],
    ['showBeforeAfter', s => { s.parts[0].element.src += '#new' }],
    ['quoteIdea', s => { s.element = { ...s.element } }],
    ['followChart', s => { s.line.attributes['data-buddy-points'] = '[[160,390],[240.000000001,320]]' }],
    ['traceFlow', s => { s.line.attributes.d = 'M320 300L430.000000001 300' }]
  ]) {
    const f = fixture(id)
    try {
      const source = f.source(), attributes = { 'data-buddy-points': '[[160,390],[240,320]]', d: 'M320 300L430 300' },
        line = { attributes, getAttribute: name => attributes[name] ?? null }
      source.line = line
      source.element.querySelectorAll = () => [line]
      source.parts[0].media = { width: 260, height: 200, copyable: true, reason: null }
      source.fact.value = 1
      f.start(); change(source)
      assert.equal(f.player.refresh(), true, id + ': смысловое или авторское изменение прекращает номер')
    } finally { f.close() }
  }
})

test('крупный план указки ограничен локальным реквизитом, а слишком большой crop честно отвергается', () => {
  for (const id of ['followChart', 'traceFlow']) {
    const f = fixture(id)
    try {
      const action = f.start(); f.advance(4)
      const detail = action.detailBounds(), b = f.raw.B
      assert.ok(detail && detail[0] > b.x - 45 && detail[2] < b.x + 45)
      assert.ok(detail[1] > b.y - 75, 'Удалённый курсор графика не растягивает ручной крупный план')
    } finally { f.close() }
  }
  const f = fixture('inspectDetail')
  try {
    f.source().fact.structure.crop.width = 200
    assert.ok(f.player.can('inspectDetail')); assert.equal(f.player.create('inspectDetail'), null)
  } finally { f.close() }
})

test('изменение media marker отменяет старую копию даже при прежних bounds и can возвращает причину', () => {
  for (const id of ['inspectDetail', 'showBeforeAfter']) {
    const f = fixture(id)
    try {
      const part = f.source().parts[0]
      part.media = { width: 260, height: 200, copyable: true, reason: '' }
      f.start(); f.advance(3)
      part.media = { ...part.media, copyable: false, reason: 'Корневой поворот не поддерживается' }
      assert.equal(f.player.refresh(), true)
      assert.equal(f.layers().length, 0)
      f.raw.reset()
      assert.equal(f.player.can(id), part.media.reason)
      assert.equal(f.player.create(id), null)
    } finally { f.close() }
  }
})

test('длинный список получает отказ, а допустимые переносы не пересекают соседние строки', () => {
  const f = fixture('assembleList')
  try {
    const source = f.source(), text = 'Сверить точное значение с исходным документом и сохранить единицу измерения'
    source.fact.structure.items[0].text = text
    assert.equal(f.player.can('assembleList'), null)
    f.start(); f.advance(7)
    const row = f.nodes().find(node => node.getAttribute('data-story-item') === 'a'),
      rect = row.children.find(node => node.tagName === 'RECT'), t = row.children.find(node => node.tagName === 'TEXT')
    assert.ok(+rect.getAttribute('height') > 45, 'Перенос увеличивает реальную высоту карточки')
    assert.equal(t.children.map(node => node.textContent).join(''), text)
    assert.ok(t.children.length > 1)
    assert.ok(t.children.slice(0, -1).every(node => /\s$/u.test(node.textContent)), 'Короткие слова не разрываются на границе строки')
    f.player.reset(); f.raw.reset()
    source.fact.structure.items = Array.from({ length: 8 }, (_, i) => ({ ...source.fact.structure.items[0], id: 'long-' + i, text: text.repeat(2) }))
    assert.ok(f.player.can('assembleList')); assert.equal(f.player.create('assembleList'), null)
  } finally { f.close() }
})

test('chartClimb использует три столбца ступенями без промежуточного спуска на пол', () => {
  for (const face of [-1, 1]) {
    const f = fixture('chartClimb', face)
    try {
      const boxes = [[350, 520, 150], [600, 450, 150], [850, 380, 150]], source = f.source()
      f.raw.W.plats = boxes.map(([x, y, width]) => ({ kind: 'plat', x1: x, x2: x + width, y,
        spans: [[x + 12, x + width - 12]], rad: 8 }))
      f.raw.W.walls = f.raw.W.plats.map(plat => ({ x: plat.x1, side: -1, top: plat.y, bottom: 670,
        gap: 30, h: f.raw.W.floor.y - plat.y, footX: plat.x1 - 12, topX: plat.x1 + 18, plat }))
      source.fact.structure.items = f.raw.W.plats.map((plat, i) => ({ id: 'bar-' + i, text: (i + 1) + ' %',
        target: { x: (plat.x1 + plat.x2) / 2, y: (plat.y + 670) / 2, width: plat.x2 - plat.x1, height: 670 - plat.y } }))
      const visited = new Set()
      let betweenPlatforms = false, groundedBetween = false
      f.start(); f.advance(f.entry.duration + .2, () => {
        const b = f.raw.B
        if (b.surf?.kind === 'plat') { visited.add(b.surf); betweenPlatforms = visited.size < 3 }
        else if (betweenPlatforms && b.y > f.raw.W.floor.y - 55) groundedBetween = true
      })
      assert.equal(visited.size, 3)
      assert.equal(groundedBetween, false, 'После первого подъёма промежуточного возвращения на пол нет')
      assert.equal(f.raw.B.surf, f.raw.W.floor)
      f.raw.reset(); f.raw.W.plats[1].y = 200
      assert.ok(f.player.can('chartClimb'), 'Недопустимый перепад высоты честно запрещён')
    } finally { f.close() }
  }
})

test('reset и прерывание в воздухе очищают реквизит без телепорта; старый refresh не отменяет новый номер', () => {
  for (const id of ['chartClimb', 'cardRoute']) {
    const f = fixture(id, 1, 'webgl')
    try {
      f.start(); f.advance(5)
      const before = [f.raw.B.x, f.raw.B.y]
      assert.equal(f.raw.B.mode, 'free')
      assert.ok(f.raw.B.y < f.raw.W.floor.y - 50, 'Отмена происходит в воздухе, а не во время подхода по полу')
      f.player.reset()
      assert.deepEqual([f.raw.B.x, f.raw.B.y], before)
      assert.equal(f.layers().length, 0)
      f.raw.run(['wave']); f.selection(null)
      assert.equal(f.player.refresh(), false)
      assert.notEqual(f.raw.B.act.name, id)
    } finally { f.close() }
  }
  const f = fixture('compareValues', 1, 'webgl')
  try {
    f.start(); f.advance(3); f.raw.run(['wave']); f.selection(null)
    assert.equal(f.player.refresh(), false); assert.equal(f.raw.B.act.name, 'wave')
    assert.ok(f.records.every(record => record.state.done)); assert.equal(f.layers().length, 0)
  } finally { f.close() }
})

test('небезопасная геометрия, неполная структура и разные единицы получают честный отказ', () => {
  for (const id of ['chartClimb', 'cardRoute']) {
    const f = fixture(id)
    try {
      f.raw.W.plats[0].spans = [[772, 783]]
      assert.ok(f.player.can(id)); assert.equal(f.player.create(id), null)
      f.raw.W.plats[0].spans = [[772, 868]]; f.raw.W.walls[0].h = 500
      assert.ok(f.player.can(id)); assert.equal(f.player.create(id), null)
    } finally { f.close() }
  }
  const f = fixture('compareValues')
  try {
    f.source().fact.structure.items[1].unit = 'мс'
    assert.ok(f.player.can('compareValues')); assert.equal(f.player.create('compareValues'), null)
    f.selection(null); assert.ok(f.player.can('compareValues'))
    assert.ok(f.player.can('unknown'))
    f.player.destroy(); assert.ok(f.player.can('compareValues'))
  } finally { f.close() }
})
