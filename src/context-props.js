const pi = Math.PI, tau = pi * 2,
  clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, Number.isFinite(value) ? value : min)),
  look = (base, ol, shade = [.67, .72, .76]) => ({ base, ol, shade, hi: [1.15, 1.16, 1.14] }),
  looks = {
    case: look('#C7D0DB', '#526176'), edge: look('#8898AB', '#3D4F65'),
    dark: look('#23344B', '#102036'), key: look('#E8EDF2', '#718096'),
    green: look('#35D483', '#0C6647', [.48, .77, .65]),
    mint: look('#B1FFD9', '#25976B', [.67, .84, .75]),
    bright: look('#3CE798', '#18875C', [.55, .8, .69])
  },
  concepts = new Set(['memory', 'target', 'team', 'chain', 'link', 'cloud', 'rules', 'search'])

/** Ленивые объёмные предметы контекстных номеров. Размеры — в единицах скелета. */
export function createContextPropBuilders(kit) {
  const { THREE: T, U } = kit,
    vec = ([x, y, z]) => new T.Vector3(x * U, y * U, z * U),
    sphere = radius => new T.SphereGeometry(radius * U, 16, 10),
    torus = (radius, thickness = 1.6) => new T.TorusGeometry(radius * U, thickness * U, 8, 40)

  function build() {
    const g = new T.Group(), materials = new Map()
    let currentFade = 1
    function mesh(geometry, color, parent = g, options = {}) {
      const key = `${color}:${options.alpha ?? 1}:${options.outline !== false}`
      let material = materials.get(key)
      if (!material) {
        material = kit.material(looks[color], options); materials.set(key, material); kit.opacity(material, currentFade)
      }
      return kit.mesh(geometry, material, parent)
    }
    function box(w, h, d, color, parent = g, radius = .8, options) {
      return mesh(kit.rbox(w, h, d, radius), color, parent, options)
    }
    function rod(a, b, radius, color, parent = g, options) {
      const m = mesh(new T.CylinderGeometry(radius * U, radius * U, 1, 8), color, parent, options)
      kit.segTo(m, vec(a), vec(b))
      return m
    }
    return { g, mesh, box, rod, finish(update = () => {}) {
      return { g, upd(P) {
        const fade = P.fade == null ? 1 : clamp(P.fade)
        currentFade = fade
        for (const material of materials.values()) kit.opacity(material, fade)
        g.visible = fade > .001
        update(P, materials.values().next().value?.m.uniforms.uOpacity.value ?? fade)
      } }
    } }
  }

  function screenText(canvas, text) {
    const ctx = canvas.getContext('2d'), width = canvas.width - 104, height = canvas.height - 116
    let font = 54, lines
    do {
      ctx.font = `500 ${font}px sans-serif`
      lines = ['']
      for (const char of text) {
        const last = lines.length - 1
        if (char === '\n') lines.push('')
        else if (lines[last] && ctx.measureText(lines[last] + char).width > width) lines.push(char)
        else lines[last] += char
      }
      if (lines.length * font * 1.32 <= height || font <= 10) break
      font -= 2
    } while (true)
    ctx.fillStyle = '#F3FBF7'; ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.fillStyle = '#139563'; ctx.fillRect(0, 0, canvas.width, 18)
    ctx.fillStyle = '#173D33'; ctx.textBaseline = 'top'
    lines.forEach((line, i) => ctx.fillText(line, 52, 62 + i * font * 1.32))
  }

  return {
    contextLaptop() {
      const { g, mesh, box, finish } = build(), hinge = new T.Group(), keys = [],
        base = box(68, 3, 46, 'case', g, 1.2), canvas = document.createElement('canvas')
      g.name = 'context-laptop'; base.name = 'laptop-base'; base.position.y = 1.5 * U
      hinge.name = 'laptop-hinge'; hinge.position.set(0, 3 * U, -20 * U); g.add(hinge)
      const barrel = mesh(new T.CylinderGeometry(1.8 * U, 1.8 * U, 61 * U, 10), 'edge')
      barrel.rotation.z = pi / 2; barrel.position.copy(hinge.position)
      const lid = box(65, 45, 2.5, 'case', hinge, 1.2)
      lid.name = 'laptop-lid'; lid.position.y = 22.5 * U
      box(60.6, 39.4, .45, 'dark', hinge, .4).position.set(0, 22.8 * U, 1.37 * U)
      canvas.width = 1024; canvas.height = 640
      const texture = new T.CanvasTexture(canvas), material = new T.MeshBasicMaterial({ map: texture, transparent: true }),
        screen = new T.Mesh(new T.PlaneGeometry(57.8 * U, 36.2 * U), material)
      texture.colorSpace = T.SRGBColorSpace
      screen.name = 'laptop-screen'; screen.frustumCulled = false
      screen.position.set(0, 22.8 * U, 1.64 * U); hinge.add(screen)
      // runtime освобождает достижимые материалы; владелец экрана освобождает его единственную текстуру.
      const disposeScreen = () => { material.removeEventListener('dispose', disposeScreen); texture.dispose() }
      material.addEventListener('dispose', disposeScreen)
      for (let row = 0; row < 4; row++) for (let col = 0; col < 11; col++) {
        const key = box(4.6, .55, 4.2, 'key', g, .3, { outline: false })
        key.name = 'laptop-key'; key.position.set((-26 + col * 5.2) * U, 3.25 * U, (-12 + row * 5.1) * U)
        keys.push(key)
      }
      box(21, .28, 8, 'edge', g, .7, { outline: false }).position.set(0, 3.15 * U, 15 * U)
      let previousText
      return finish((P, alpha) => {
        const text = String(P.text ?? ''), typing = clamp(P.typing || 0), time = P.t || 0
        hinge.rotation.x = pi / 2 * (1 - clamp(P.open == null ? 1 : P.open)) - .18 * clamp(P.open == null ? 1 : P.open)
        if (text !== previousText) {
          screenText(canvas, text); screen.userData.text = text; texture.needsUpdate = true; previousText = text
        }
        material.opacity = alpha
        keys.forEach((key, i) => { key.position.y = (3.25 - .22 * typing * Math.max(0, Math.sin(time * 19 + i * 2.7)) ** 12) * U })
      })
    },

    contextRing() {
      const { g, mesh, finish } = build(), beam = new T.Group(), pulses = [],
        beamDirection = new T.Vector3(), beamUp = new T.Vector3(0, 1, 0)
      g.name = 'context-ring'; beam.name = 'ring-projection'; g.add(beam)
      const band = mesh(torus(6.5, 1.05), 'bright')
      band.name = 'ring-band'; band.rotation.x = pi / 2
      const inner = mesh(torus(4.9, .35), 'mint', g, { alpha: .9, outline: false })
      inner.rotation.x = pi / 2
      const cone = mesh(new T.CylinderGeometry(14 * U, 3.5 * U, 38 * U, 24, 1, true), 'green', beam,
        { alpha: .1, outline: false, depthWrite: false, side: 2 })
      cone.position.y = 20 * U
      for (let i = 0; i < 3; i++) {
        const pulse = mesh(torus(5 + i * 3.8, .32), 'mint', beam, { alpha: .5, outline: false, depthWrite: false })
        pulse.rotation.x = pi / 2; pulse.position.y = (8 + i * 13) * U; pulses.push(pulse)
      }
      return finish(P => {
        const pulse = clamp(P.pulse == null ? .5 + .5 * Math.sin((P.t || 0) * 4) : P.pulse), amount = clamp(P.beam || 0)
        band.scale.setScalar(1 + .06 * pulse); inner.scale.setScalar(1 + .12 * pulse)
        beam.visible = amount > .001
        if (P.beamEnd) {
          beamDirection.set(P.beamEnd[2], -P.beamEnd[1], P.beamEnd[0])
          const length = beamDirection.length()
          beam.quaternion.setFromUnitVectors(beamUp, beamDirection.normalize())
          beam.scale.y = Math.max(.001, amount * length / 38)
        } else { beam.quaternion.identity(); beam.scale.y = Math.max(.001, amount) }
        pulses.forEach((ring, i) => ring.scale.setScalar(.94 + .08 * Math.sin((P.t || 0) * 3 - i)))
      })
    },

    contextConcept() {
      const { g, mesh, box, rod, finish } = build(), variants = new Map(),
        volume = { alpha: .74, outline: false }, light = { alpha: .95, outline: false }
      g.name = 'context-concept'
      function ball(radius, at, parent, color = 'green') {
        const object = mesh(sphere(radius), color, parent, volume)
        object.position.copy(vec(at)); return object
      }
      function circle(radius, at, parent, thickness = 1.6, color = 'mint') {
        const object = mesh(torus(radius, thickness), color, parent, light)
        object.position.copy(vec(at)); return object
      }
      function create(concept) {
        const group = new T.Group(); group.name = 'concept-' + concept; g.add(group)
        if (concept === 'memory') {
          box(36, 35, 10, 'green', group, 2, volume).position.y = 28 * U
          box(25, 24, 1.2, 'mint', group, 1, light).position.set(0, 28 * U, 5.8 * U)
          for (const side of [-1, 1]) for (let i = 0; i < 5; i++) {
            box(3, 3.8, 7, 'bright', group, .5, light).position.set(side * 20 * U, (16 + i * 6) * U, 0)
            box(3.8, 4.7, 7, 'bright', group, .5, light).position.set((-12 + i * 6) * U, (28 + side * 20) * U, 0)
          }
          for (const [x, y] of [[-6, 25], [6, 25], [0, 34]]) ball(2.6, [x, y, 7], group, 'bright')
          rod([-6, 25, 7], [0, 34, 7], .8, 'green', group, light)
          rod([6, 25, 7], [0, 34, 7], .8, 'green', group, light)
        } else if (concept === 'target') {
          for (const radius of [25, 17, 8.5]) circle(radius, [0, 28, 0], group, radius > 20 ? 2 : 1.5)
          ball(3.2, [0, 28, 1.5], group, 'bright')
          rod([0, 28, 6], [24, 49, 14], 1.3, 'bright', group, light)
          for (const side of [-1, 1]) rod([24, 49, 14], [24 - 8 + side * 5, 49 - 7 - side * 5, 14], 1.5, 'mint', group, light)
        } else if (concept === 'team') {
          for (const [x, y, z, radius] of [[-21, 32, -3, 8.2], [21, 32, -3, 8.2], [0, 45, 5, 9.2]]) {
            ball(radius, [x, y, z], group, 'mint')
            const body = mesh(new T.CylinderGeometry(7 * U, 12 * U, 21 * U, 14), 'green', group, volume)
            body.position.copy(vec([x, y - radius - 12, z])); body.scale.z = .7
          }
        } else if (concept === 'chain' || concept === 'link') {
          for (let i = 0; i < (concept === 'chain' ? 3 : 2); i++) {
            const link = circle(concept === 'chain' ? 15 : 20,
              concept === 'chain' ? [-18 + i * 18, 17 + i * 12, 0] : [-12 + i * 24, 28, 0], group, 3)
            link.scale.set(concept === 'chain' ? .82 : .75, 1, 1)
            link.rotation.y = i % 2 ? .9 : -.35; link.rotation.z = -.5
          }
        } else if (concept === 'cloud') {
          for (const [radius, at] of [[16, [-19, 24, 0]], [21, [0, 34, -1]], [17, [20, 25, 1]], [15, [0, 19, 5]]]) {
            ball(radius, at, group)
          }
          for (const [x, y, z] of [[-16, 31, 13], [0, 46, 11], [20, 32, 15]]) ball(3.5, [x, y, z], group, 'mint')
        } else if (concept === 'rules') {
          for (let i = 2; i >= 0; i--) {
            box(38, 49, 2.1, i ? 'green' : 'mint', group, 1.6, volume)
              .position.set(i * 2.3 * U, (27 + i * 1.5) * U, -i * 2.9 * U)
          }
          for (let i = 0; i < 3; i++) {
            const y = 14 + i * 13
            rod([-13, y, 2], [-9, y - 3, 2], 1.2, 'green', group, light)
            rod([-9, y - 3, 2], [-3, y + 4, 2], 1.2, 'green', group, light)
            box(13, 1.8, 1.1, 'green', group, .5, light).position.set(7 * U, y * U, 2 * U)
          }
        } else {
          circle(18, [-7, 36, 0], group, 3)
          const glass = mesh(new T.CylinderGeometry(16 * U, 16 * U, 1.6 * U, 30), 'green', group,
            { alpha: .15, outline: false, depthWrite: false })
          glass.rotation.x = pi / 2; glass.position.copy(vec([-7, 36, 0]))
          rod([6, 23, 0], [25, 4, 0], 4, 'bright', group, light)
          rod([-16, 40, 2], [-10, 47, 2], 1.5, 'mint', group, light)
        }
        variants.set(concept, group); return group
      }
      return finish(P => {
        const concept = concepts.has(P.concept) ? P.concept : 'memory',
          selected = variants.get(concept) || create(concept), progress = clamp(P.progress == null ? 1 : P.progress)
        for (const [key, group] of variants) group.visible = key === concept && progress > .001
        selected.scale.setScalar(.85 + .15 * progress)
        selected.rotation.y = Math.sin((P.t || 0) * .6) * .12
      })
    }
  }
}
