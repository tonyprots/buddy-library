import assert from 'node:assert/strict'
import { test } from 'node:test'
import { writeFileSync } from 'node:fs'
import { runtimeFixture } from '../support/runtime-fixture.mjs'
import { palmGeometry } from '../support/palm-geometry.mjs'

function fixture(face, top) {
  const f = runtimeFixture(face), card = new f.host.constructor('div'), style = getComputedStyle
  card.closest = () => null
  card.hasAttribute = name => card.getAttribute(name) !== null
  card.getBoundingClientRect = () => ({ left: 360, top, right: 660, bottom: 620, width: 300, height: 620 - top })
  f.slide.querySelectorAll = selector => selector === '*' ? [card] : []
  globalThis.getComputedStyle = node => node === card
    ? { backgroundColor: 'rgb(210,220,240)', borderTopWidth: '0', borderTopLeftRadius: '18' } : style(node)
  f.raw.rescan()
  f.raw.W.walls = f.raw.W.walls.filter(wall => wall.side === -face)
  Object.assign(f.raw.B, { x: face > 0 ? 340 : 680, anchor: null })
  return f
}

// Инвариант: прилёт переходит в несущий хват без смены положения тела/локтя
// одним кадром; следующий основной цикл и время завершения не сдвигаются.
test('pullups: непрерывный fly→pull и реальный GLB хват скруглённой кромки ±120Hz', async () => {
  const boot = runtimeFixture(), previous = document, rows = [], context = new Proxy({}, { get: () => () => {} })
  let rig
  try {
    globalThis.document = { createElement: () => ({ getContext: () => context }) }
    const { Buddy3D, THREE: T } = await import('../../src/vendor.js')
    rig = Buddy3D.create({ outline: false }); await rig.loaded; globalThis.document = previous
    const geometry = palmGeometry(rig, T)
    const neutral = boot.raw.tools.pose({ hp: 14, tl: 7 }), neutralK = boot.raw.tools.solve(neutral, 1, .4),
      bones = () => [...geometry.bones.values()].map(b => [...b.position.toArray(), ...b.quaternion.toArray(), ...b.scale.toArray()])
    rig.pose(neutralK, neutral, { yaw: .4 }); const before = bones()
    rig.pose(neutralK, { ...neutral, handTask: { kind: 'ledge', face: 1, amount: [0, 0] } }, { yaw: .4 })
    assert.deepEqual(bones(), before, 'Нулевой ledge-канал не меняет ни одну настоящую кость')
    for (const top of [420, 470]) for (const face of [-1, 1]) {
      const f = fixture(face, top), { raw } = f, { B } = raw,
        row = { face, top, maxPrepAngle: 0, maxPrepHandStep: 0, maxSettleAngle: 0, maxSettleBodyStep: 0, minWallNormal: 1, minFingerInward: Infinity,
          minThumbOutward: Infinity, minTipBeyondEdge: Infinity, minThumbOutsideEdge: Infinity,
          minSkinEdgeGap: Infinity, maxSkinEdgeGap: 0, maxModelWristError: 0, minReachMargin: Infinity,
          maxArmLengthError: 0, contactFrames: 0 }
      try {
        assert.equal(raw.availability('pullups'), null)
        raw.run(['pullups'])
        let prior, fullPullPoseAt = null, started = false
        const wall = raw.W.walls[0], radius = wall.plat.rad,
          edgeX = y => wall.x + face * (y < wall.top + radius
            ? radius - Math.sqrt(Math.max(0, radius ** 2 - (wall.top + radius - y) ** 2))
            : y > wall.bottom - radius
              ? radius - Math.sqrt(Math.max(0, radius ** 2 - (y - wall.bottom + radius) ** 2)) : 0)
        for (let n = 0; n < 2000; n++) {
          raw.step(1 / 120, 120)
          if (B.act.name === 'climb') started = true
          if (started && B.act.name !== 'climb') { row.endedAt = prior.t + 1 / 120; break }
          if (!started) continue
          const t = B.act.t, p = B.pose
          const hands = B.kk.arms.map(a => [B.x + (a.hand[0] * Math.cos(B.yaw) - a.hand[2] * Math.sin(B.yaw)) * raw.tools.S * B.scale,
            B.y + a.hand[1] * raw.tools.S * B.scale])
          if (prior && t >= .5 && t <= 1) {
            row.maxPrepAngle = Math.max(row.maxPrepAngle, ...['sf', 'sa', 'ef', 'ea'].flatMap(key => p[key].map((v, i) => Math.abs(v - prior.pose[key][i]))))
            row.maxPrepHandStep = Math.max(row.maxPrepHandStep, ...hands.map((v, i) => Math.hypot(v[0] - prior.hands[i][0], v[1] - prior.hands[i][1])))
          }
          // Конец оседания по базовой позе; канал хвата не служит оракулом.
          if (t > 1.7 && p.af[0] <= -33.99 && fullPullPoseAt === null) fullPullPoseAt = t
          if (prior && t >= 1.65 && t <= 2.1) {
            row.maxSettleBodyStep = Math.max(row.maxSettleBodyStep, Math.hypot(B.x - prior.x, B.y - prior.y))
            row.maxSettleAngle = Math.max(row.maxSettleAngle, ...['sf', 'ef'].flatMap(key => p[key].map((v, i) => Math.abs(v - prior.pose[key][i]))))
          }
          if (t >= 2.1 && n % 4 === 0) {
            rig.pose(B.kk, p, { yaw: B.yaw, head: 1.5 })
            // Длины проверяются до общего сценического squash, в единицах GLB.
            for (const suffix of ['L', 'R']) {
              const point = name => geometry.bones.get(name + suffix).getWorldPosition(new T.Vector3()),
                upper = point('UpperArm'), elbow = point('LowerArm'), wrist = point('Wrist')
              row.maxArmLengthError = Math.max(row.maxArmLengthError,
                Math.abs(upper.distanceTo(elbow) / Buddy3D.U - 14), Math.abs(elbow.distanceTo(wrist) / Buddy3D.U - 12.5))
            }
            const fy = Math.max(...B.kk.legs.flatMap(g => [g.heel[1], g.toe[1]])), scale = raw.tools.S * B.scale,
              sq = B.sq * .8
            rig.place(B.x, B.y + fy * scale, fy, scale, [1 - sq * .55, 1 + sq], B.yaw)
            for (const [side, hand] of geometry.read().entries()) {
              row.minWallNormal = Math.min(row.minWallNormal, hand.normal.x * face)
              const edgeGap = Math.min(...hand.skin.filter(v => -v.y >= wall.top && -v.y <= wall.bottom)
                .map(v => Math.abs(v.x - edgeX(-v.y))))
              row.minSkinEdgeGap = Math.min(row.minSkinEdgeGap, edgeGap)
              row.maxSkinEdgeGap = Math.max(row.maxSkinEdgeGap, edgeGap)
              const suffix = hand.side, point = name => geometry.bones.get(name + suffix).getWorldPosition(new T.Vector3()),
                knuckle = point('Middle1'), tip = point('Middle3'), thumb = point('Thumb2'), wrist = point('Wrist')
              if (!row.offsets) row.offsets = { tip: (tip.x - wrist.x) * face, thumb: (thumb.x - wrist.x) * face,
                tipY: -tip.y + wrist.y, thumbY: -thumb.y + wrist.y, wristEdge: (wrist.x - edgeX(-wrist.y)) * face }
              const model = B.kk.arms[side].wrist,
                mx = B.x + (model[0] * Math.cos(B.yaw) - model[2] * Math.sin(B.yaw)) * scale * (1 - sq * .55),
                my = B.y + fy * scale + (model[1] - fy) * scale * (1 + sq)
              row.maxModelWristError = Math.max(row.maxModelWristError, Math.hypot(wrist.x - mx, -wrist.y - my))
              const gy = 600 + side * 1.5 * .9, tx = edgeX(gy) - face * 1.1 * .9, ty = gy + 6 * .9,
                shoulder = B.kk.arms[side].sh,
                sx = B.x + (shoulder[0] * Math.cos(B.yaw) - shoulder[2] * Math.sin(B.yaw)) * scale,
                sy = B.y + shoulder[1] * scale,
                reach = (14 * Math.cos(p.sa[side] * Math.PI / 180) + 12.5 * Math.cos((p.sa[side] + p.ea[side]) * Math.PI / 180)) * scale
              row.minReachMargin = Math.min(row.minReachMargin, reach - Math.hypot(tx - sx, ty - sy))
              row.minFingerInward = Math.min(row.minFingerInward, (tip.x - knuckle.x) * face)
              row.minThumbOutward = Math.min(row.minThumbOutward, (tip.x - thumb.x) * face)
              row.minTipBeyondEdge = Math.min(row.minTipBeyondEdge, (tip.x - edgeX(-tip.y)) * face)
              row.minThumbOutsideEdge = Math.min(row.minThumbOutsideEdge, (edgeX(-thumb.y) - thumb.x) * face)
            }
            row.contactFrames++
          }
          prior = { t, x: B.x, y: B.y, pose: structuredClone(p), hands }
        }
        row.fullPullPoseAt = fullPullPoseAt; rows.push(row)
      } finally { f.close() }
    }
    if (process.env.BUDDY_PULLUPS_REPORT) writeFileSync(process.env.BUDDY_PULLUPS_REPORT, JSON.stringify({ rows }, null, 2) + '\n')
    for (const row of rows) {
      const detail = JSON.stringify(row)
      assert.ok(row.contactFrames > 30, 'Наблюдались реальные циклы хвата. ' + detail)
      assert.ok(row.maxPrepAngle < 12 && row.maxPrepHandStep < 4, 'Руки готовят прыжок без ускоренного рывка за.09s. ' + detail)
      assert.ok(row.maxSettleAngle < 12, 'Локоть не переключается более12°/120Hz на стыке. ' + detail)
      assert.ok(row.maxSettleBodyStep < 2, 'Тело не скачет на стыке. ' + detail)
      assert.ok(row.minWallNormal > .9, 'Лицевая ладонь обращена к стене. ' + detail)
      assert.ok(row.minFingerInward > .05 && row.minThumbOutward > .05, 'Настоящие пальцы охватывают кромку с противопоставленным большим пальцем. ' + detail)
      assert.ok(row.minTipBeyondEdge > .05 && row.minThumbOutsideEdge > .05, 'Фаланги и большой палец находятся с разных сторон конечной скруглённой кромки. ' + detail)
      assert.ok(row.maxSkinEdgeGap < .5, 'Skin кисти касается физической кромки. ' + detail)
      assert.ok(row.minReachMargin > .05, 'Цель запястья достижима с запасом. ' + detail)
      assert.ok(row.maxArmLengthError < .001, 'Настоящие руки сохраняют длины14/12.5 без растяжения. ' + detail)
    }
  } finally { globalThis.document = previous; boot.close() }
})
