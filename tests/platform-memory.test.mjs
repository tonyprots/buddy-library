import assert from 'node:assert/strict'
import { test } from 'node:test'
import { runtimeFixture } from './support/runtime-fixture.mjs'

function fixture() {
  const f = runtimeFixture(), card = new f.host.constructor('div'), style = globalThis.getComputedStyle
  card.closest = () => null
  card.getBoundingClientRect = () => ({ left: 340, top: 470, right: 540, bottom: 640, width: 200, height: 170 })
  f.slide.querySelectorAll = selector => selector === '*' ? [card] : []
  globalThis.getComputedStyle = node => node === card
    ? { backgroundColor: 'rgb(210,220,240)', borderTopWidth: '0', borderTopLeftRadius: '18' } : style(node)
  f.raw.rescan(); f.raw.B.x = 320
  assert.equal(f.raw.W.plats.length, 1)
  assert.ok(f.raw.W.walls.length)
  return f
}

test('пересканирование той же площадки сохраняет время знакомства с ней', () => {
  const f = fixture()
  try {
    const { B, W } = f.raw
    B.surf = B.topSurf = W.plats[0]; B.surfY = B.surf.y; B.topSince = W.time - 7
    const since = B.topSince, old = B.surf
    f.raw.rescan()
    assert.notEqual(B.surf, old, 'Анализатор действительно создал новый объект той же опоры')
    assert.equal(B.topSurf, B.surf, 'Память привязана к пересчитанной опоре')
    assert.equal(B.topSince, since, 'Шесть секунд не начинаются заново от rescan')
  } finally { f.close() }
})

test('reset снимает паузу после спуска и память прежней площадки', () => {
  const f = fixture()
  try {
    const { B, W } = f.raw
    B.topSurf = W.plats[0]; B.topSince = W.time; B.downAt = W.time
    f.raw.reset()
    assert.equal(B.topSurf, null)
    assert.ok(f.raw.MAKE.climb(), 'Новый ручной прогон не заблокирован прошлым спуском')
  } finally { f.close() }
})

test('пауза возвращения на блок длится 15 секунд после приземления', () => {
  const f = fixture()
  try {
    const { B, W } = f.raw
    B.surf = B.topSurf = W.plats[0]; B.surfY = B.surf.y; B.x = 390; B.topSince = W.time - 10
    f.raw.posed({ still: 1 }); f.raw.step(.1)
    f.raw.run(['descend'])
    let landed = null
    for (let frame = 0; frame < 2400; frame++) {
      f.raw.step(1 / 60)
      if (B.mode === 'ground' && B.surf.kind === 'floor') { landed = W.time; break }
    }
    assert.ok(landed !== null, 'Спуск действительно закончился на полу')
    assert.ok(Math.abs(B.downAt - landed) <= 1 / 60, 'Отсчёт начинается на полу, а не перед подходом к краю')
    assert.equal(B.topSurf, null)
    assert.ok(f.raw.availability('climb'), 'API заранее объясняет временную недоступность')
    for (const id of ['web', 'pullups']) assert.ok(f.raw.availability(id), `${id}: пауза распространяется на все пути наверх`)
    f.raw.step(14.9)
    assert.equal(f.raw.MAKE.climb(), null)
    assert.equal(f.raw.MAKE.pullups(), null, 'Только что слез — сразу на кромку не виснет')
    f.raw.step(.2)
    assert.equal(f.raw.availability('climb'), null)
    assert.ok(f.raw.MAKE.climb(), 'После паузы путь снова доступен')
  } finally { f.close() }
})

test('первое устойчивое приземление на блок записывается до следующего решения', () => {
  const f = fixture()
  try {
    const { B, W } = f.raw
    B.surf = W.plats[0]; B.surfY = B.surf.y; B.x = 390
    f.raw.posed({ still: 1 }); f.raw.step(1 / 60)
    assert.equal(B.topSurf, B.surf)
    assert.ok(Math.abs(B.topSince - W.time) <= 1 / 60)
  } finally { f.close() }
})

test('самостоятельное решение не спускает бадди до шести секунд на новой опоре', () => {
  const f = fixture()
  try {
    const { B, W } = f.raw
    B.surf = W.plats[0]; B.surfY = B.surf.y; B.x = 390
    f.raw.posed({ still: 1 }); f.raw.step(1 / 60)
    const since = B.topSince
    B.upCount = 100; B.upLimit = 0; W.time = since + 5.9
    f.raw.autonomous(true); B.act = null; f.raw.step(1 / 60)
    assert.equal(B.surf.kind, 'plat')
    assert.equal(B.queue.length, 0, 'Свежая опора не ставит спуск в очередь')
    W.time = since + 6.1; B.act = null; f.raw.step(1 / 60)
    assert.ok(B.queue.length > 0, 'После шести секунд счётчик снова разрешает запланировать спуск')
  } finally { f.close() }
})

test('лазанье не выбирает кромку под соседней карточкой с зазором 12 px', () => {
  const f = fixture()
  try {
    assert.ok(f.raw.MAKE.climb(), 'До добавления верхней карточки подъём доступен')
    f.raw.B.queue = []
    f.raw.W.plats.push({ kind: 'plat', x1: 340, x2: 540, y: 400, box: { y2: 458 }, spans: [[362, 518]] })
    assert.equal(f.raw.MAKE.climb(), null)
  } finally { f.close() }
})
