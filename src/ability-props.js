const pi = Math.PI, tau = pi * 2,
  clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, Number.isFinite(value) ? value : min)),
  hash = n => { const value = Math.sin(n * 127.1 + 311.7) * 43758.5453; return value - Math.floor(value) },
  look = (base, ol, shade = [.62, .64, .78], hi = [1.18, 1.15, 1.08]) => ({ base, ol, shade, hi }),
  looks = {
    blue: look('#2454E5', '#102A80'), deep: look('#183477', '#091B44'),
    cyan: look('#88C9E8', '#2A627A', [.68, .8, .87]), lime: look('#C6F432', '#526C12', [.72, .78, .53]),
    white: look('#FFF8E9', '#A2937C', [.86, .82, .77]), gold: look('#FFC24A', '#9B5B12', [.82, .58, .3]),
    orange: look('#F88B31', '#9B3817', [.75, .45, .3]), red: look('#E54B32', '#7C2114'),
    rock: look('#66504B', '#2D211E', [.55, .47, .44], [1.25, 1.12, 1.04]),
    crater: look('#352A2B', '#171216', [.64, .56, .57]),
    wood: look('#C9955E', '#65401F', [.65, .5, .34], [1.15, 1.1, 1.02]),
    woodRail: look('#DDA86E', '#79502A', [.67, .52, .35], [1.15, 1.1, 1.02]),
    woodGroove: look('#825330', '#492B16', [.7, .53, .36]),
    metal: { ...look('#A5B4C6', '#46546A', [.6, .66, .74], [1.4, 1.38, 1.33]), spec: .7 },
    dark: look('#2A3346', '#0E1420', [.61, .63, .7], [1.3, 1.3, 1.3])
  }

/** Ленивые 3D-builders для рига. Все координаты геометрии заданы в единицах скелета. */
export function createAbilityPropBuilders(kit) {
  const { THREE: T, U } = kit,
    ball = (radius, segments = 12, rings = 8) => new T.SphereGeometry(radius * U, segments, rings),
    ring = (radius, thickness = .4, arc = tau) => new T.TorusGeometry(radius * U, thickness * U, 7, 32, arc),
    cylinder = (top, bottom, height, segments = 10) => new T.CylinderGeometry(top * U, bottom * U, height * U, segments),
    vec = (x, y, z) => new T.Vector3(x * U, y * U, z * U)

  function build() {
    const g = new T.Group(), materials = new Map()
    function mesh(geometry, color, parent = g, options = {}) {
      const key = `${color}:${options.alpha ?? 1}:${options.outline !== false}:${options.depthWrite !== false}:${options.side || 0}`
      let material = materials.get(key)
      if (!material) { material = kit.material(looks[color] || color, options); materials.set(key, material) }
      return kit.mesh(geometry, material, parent)
    }
    function rod(a, b, radius, color, parent = g, options) {
      const m = mesh(new T.CylinderGeometry(radius * U, radius * U, 1, 7), color, parent, options)
      kit.segTo(m, vec(...a), vec(...b))
      return m
    }
    function finish(update = () => {}, contactMeshes) {
      return { g, contactMeshes, upd(P) {
        const fade = P.fade == null ? 1 : clamp(P.fade)
        for (const material of materials.values()) kit.opacity(material, fade)
        g.visible = fade > .001
        update(P)
      } }
    }
    return { g, mesh, rod, finish }
  }

  function beveledStar(radius, depth) {
    const geometry = new T.CylinderGeometry(1, 1, depth * U, 10, 3), positions = geometry.attributes.position
    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i), z = positions.getZ(i), length = Math.hypot(x, z)
      if (length < .01) continue
      const angle = Math.atan2(x, z), sector = Math.round((angle < 0 ? angle + tau : angle) / (pi / 5)),
        bevel = Math.abs(positions.getY(i)) > depth * U * .4 ? .84 : 1,
        r = radius * (sector % 2 ? .47 : 1) * U * bevel
      positions.setXYZ(i, x / length * r, positions.getY(i), z / length * r)
    }
    geometry.rotateX(pi / 2); geometry.rotateZ(pi)
    geometry.computeVertexNormals(); geometry.computeBoundingSphere()
    return geometry
  }

  return {
    abilityComet() {
      const { g, mesh, finish } = build(), core = new T.Group(), tail = new T.Group(), embers = []
      g.add(tail, core)
      let rock = ball(5.5, 13, 9), position = rock.attributes.position
      for (let i = 0; i < position.count; i++) {
        const x = position.getX(i), y = position.getY(i), z = position.getZ(i),
          deform = .91 + .12 * Math.sin(x * 41 + y * 23) * Math.cos(z * 31 - x * 17)
        position.setXYZ(i, x * deform, y * deform, z * deform)
      }
      rock = rock.toNonIndexed(); rock.computeVertexNormals(); rock.computeBoundingSphere()
      const solid = mesh(rock, 'rock', core)
      const hot = mesh(ball(5.65, 13, 9), 'orange', core, { alpha: .24, outline: false, depthWrite: false })
      for (let i = 0; i < 5; i++) {
        const a = i * 2.4, m = mesh(ball(1.35, 7, 5), 'crater', core, { outline: false })
        m.position.set(Math.sin(a) * 4.7 * U, Math.cos(a * 1.3) * 3.7 * U, Math.cos(a) * 4.3 * U)
        m.scale.set(1, .45, .8); m.rotation.set(a * .7, a, a * .3)
      }
      const shapes = [[3.8, 35, 'red', .5], [2.9, 29, 'orange', .78], [1.7, 23, 'gold', .95]]
      for (const [radius, length, color, alpha] of shapes) {
        const m = mesh(new T.CylinderGeometry(radius * U, .03 * U, length * U, 9, 4), color, tail,
          { alpha, outline: false, depthWrite: false })
        m.rotation.x = pi / 2; m.position.z = -(length / 2 + 3) * U
      }
      const sparkGeometry = ball(.65, 5, 4)
      for (let i = 0; i < 11; i++) embers.push(mesh(sparkGeometry, i % 3 ? 'orange' : 'gold', g, { outline: false }))
      return finish(P => {
        const t = P.t || 0, spin = P.spin == null ? t : P.spin,
          amount = P.tail == null ? 1 : clamp(P.tail), heat = P.heat == null ? 1 : clamp(P.heat)
        core.rotation.set(spin * .6, spin * .4, spin * .2)
        hot.visible = heat > .02; hot.scale.setScalar(.97 + .03 * heat)
        hot.material.uniforms.uOpacity.value *= heat
        tail.visible = amount > .02
        tail.scale.set(.65 + .35 * amount, .65 + .35 * amount, Math.max(.02, amount))
        tail.rotation.z = Math.sin(t * 13) * .035
        for (let i = 0; i < embers.length; i++) {
          const m = embers[i], u = (t * (.35 + hash(i) * .22) + hash(i + 8)) % 1,
            spread = (2 + u * 5) * amount, a = hash(i + 15) * tau
          m.visible = amount > .04 && heat > .02
          m.position.set(Math.cos(a) * spread * U, Math.sin(a) * spread * U, -(5 + u * 38 * amount) * U)
          m.scale.setScalar(Math.max(.02, (1 - u) * amount * heat))
        }
      }, [solid])
    },

    abilityOrb() {
      const { g, mesh, finish } = build(), shell = new T.Group(), nucleus = new T.Group()
      shell.name = 'orb-shell'
      g.add(shell)
      // Объём заполняет всю оболочку. Внешние кольца убраны: они превращали шар в пиктограмму.
      mesh(ball(6, 20, 14), 'cyan', shell, { alpha: .17, outline: false, depthWrite: false })
      mesh(ball(5.5, 18, 12), 'blue', shell, { alpha: .5, outline: false, depthWrite: false })
      shell.add(nucleus)
      mesh(ball(3.25, 14, 10), 'white', nucleus, { alpha: .72, outline: false, depthWrite: false })
      mesh(ball(1.75, 11, 8), 'gold', nucleus, { outline: false })
      for (let i = 0; i < 3; i++) {
        const lobe = mesh(ball(1.3, 9, 7), 'white', nucleus, { alpha: .48, outline: false, depthWrite: false })
        lobe.position.set(Math.cos(i * tau / 3) * 2.3 * U, Math.sin(i * tau / 3) * 2.3 * U, .5 * U)
        lobe.scale.set(.55, 1.25, .8); lobe.rotation.z = i * tau / 3
      }
      // Блики — участки настоящей сферы, поэтому следуют её кривизне в профиль.
      mesh(new T.SphereGeometry(6.04 * U, 8, 6, .2 * pi, .18 * pi, .18 * pi, .23 * pi),
        'white', shell, { alpha: .62, outline: false, depthWrite: false })
      mesh(new T.SphereGeometry(6.05 * U, 5, 4, .71 * pi, .08 * pi, .25 * pi, .09 * pi),
        'white', shell, { alpha: .45, outline: false, depthWrite: false })
      return finish(P => {
        const t = P.t || 0, charge = P.charge == null ? 1 : clamp(P.charge),
          radius = clamp(P.radius == null ? 6 : P.radius, 6, 18)
        shell.scale.setScalar(radius / 6 * (.65 + .35 * charge + Math.sin(t * 3) * .015))
        nucleus.rotation.set(Math.sin(t * .7) * .18, t * .4, t * .27)
      })
    },

    abilityBow() {
      const { g, mesh, rod, finish } = build(), limbs = new T.Group(), string = [],
        points = [[0, -18, -5], [0, -13, -1.2], [0, -6, 1.5], [0, 0, 0], [0, 6, 1.5], [0, 13, -1.2], [0, 18, -5]],
        top = vec(0, 18, -5), bottom = vec(0, -18, -5), notch = vec(0, 0, -5)
      g.add(limbs)
      for (let i = 1; i < points.length; i++) rod(points[i - 1], points[i], i === 3 || i === 4 ? .8 : .62, 'blue', limbs)
      const grip = mesh(kit.rcyl(1.15, 1.15, 5.5, .4), 'dark')
      grip.rotation.z = .05
      for (const side of [-1, 1]) {
        const collar = mesh(cylinder(1.2, 1.2, .8), 'metal')
        collar.position.y = side * 3.2 * U
        const tip = mesh(ball(1, 7, 5), 'lime'); tip.position.set(0, side * 18 * U, -5 * U); tip.name = 'bow-tip-' + side
      }
      string.push(rod([0, 18, -5], [0, 0, -5], .24, 'white', g, { outline: false }))
      string.push(rod([0, 0, -5], [0, -18, -5], .24, 'white', g, { outline: false }))
      string[0].name = 'bow-string-upper'; string[1].name = 'bow-string-lower'
      return finish(P => {
        const draw = clamp(P.draw || 0)
        notch.set(0, 0, (-5 - 12 * draw) * U)
        kit.segTo(string[0], top, notch); kit.segTo(string[1], notch, bottom)
      })
    },

    abilityArrow() {
      const { mesh, finish } = build(), shaft = mesh(cylinder(.27, .27, 20, 8), 'gold')
      shaft.rotation.x = pi / 2; shaft.position.z = -3 * U
      const head = mesh(new T.CylinderGeometry(0, 1.25 * U, 4 * U, 4), 'metal')
      head.rotation.x = pi / 2; head.position.z = 9 * U
      const nock = mesh(kit.rcyl(.52, .52, 1.2, .2), 'lime'); nock.rotation.x = pi / 2; nock.position.z = -13.6 * U
      const fins = []
      for (let i = 0; i < 3; i++) {
        const fin = mesh(kit.rbox(.25, 2, 4.2, .1), 'blue')
        fin.position.set(Math.sin(i * tau / 3) * .75 * U, Math.cos(i * tau / 3) * .75 * U, -10.5 * U)
        fin.rotation.z = -i * tau / 3; fins.push(fin)
      }
      return finish()
    },

    abilityUmbrella() {
      const { g, mesh, rod, finish } = build(), canopy = new T.Group(), folded = new T.Group(), ribs = [], drops = [],
        radius = 25, theta = .4 * pi, offset = 24, rim = offset + radius * Math.cos(theta), rimR = radius * Math.sin(theta)
      canopy.name = 'canopy'; folded.name = 'folded-cloth'
      g.add(canopy, folded)
      mesh(cylinder(.35, .35, 53, 8), 'metal').position.y = 22 * U
      const handle = mesh(new T.TorusGeometry(2.2 * U, .65 * U, 8, 18, pi * 1.15), 'dark')
      handle.rotation.z = pi * .8; handle.position.set(1.2 * U, -4.3 * U, 0)
      mesh(kit.rcyl(.72, .72, 5.5, .3), 'dark').position.y = -.25 * U
      const top = mesh(ball(.8, 8, 6), 'metal'); top.position.y = 49 * U
      // Закрытый зонт остаётся тканевым предметом: непрозрачный свёрток, складки и ремешок.
      const cloth = mesh(new T.CylinderGeometry(1.6 * U, 3.4 * U, 22 * U, 8, 5), 'blue', folded)
      cloth.position.y = 37 * U
      for (let i = 0; i < 8; i++) {
        const angle = i * tau / 8, seam = mesh(kit.rcyl(.34, .48, 19, .17), i % 4 === 0 ? 'lime' : i % 2 ? 'deep' : 'blue', folded,
          { outline: false })
        seam.position.set(Math.cos(angle) * 2.55 * U, 36.5 * U, Math.sin(angle) * 2.55 * U)
        seam.rotation.set(Math.sin(angle) * -.08, 0, Math.cos(angle) * .08)
      }
      const strap = mesh(ring(3, .4), 'dark', folded, { outline: false })
      strap.rotation.x = pi / 2; strap.position.y = 35 * U
      const button = mesh(ball(.55, 7, 5), 'metal', folded, { outline: false })
      button.position.set(0, 35 * U, 3.25 * U)
      for (let i = 0; i < 8; i++) {
        const panel = mesh(new T.SphereGeometry(radius * U, 6, 7, i * tau / 8, tau / 8, 0, theta),
          i % 4 === 0 ? 'lime' : i % 2 ? 'blue' : 'deep', canopy, { outline: false, side: 2 })
        panel.position.y = offset * U
        const a = i * tau / 8, coords = [
          [0, 48.8, 0],
          [-Math.cos(a) * radius * Math.sin(theta * .5), offset + radius * Math.cos(theta * .5) - .2, Math.sin(a) * radius * Math.sin(theta * .5)],
          [-Math.cos(a) * rimR, rim - .2, Math.sin(a) * rimR]
        ]
        for (let j = 1; j < coords.length; j++) ribs.push(rod(coords[j - 1], coords[j], .22, 'metal', canopy, { outline: false }))
        const tip = mesh(ball(.65, 6, 5), 'metal', canopy, { outline: false })
        tip.position.set(coords[2][0] * U, rim * U, coords[2][2] * U)
      }
      const hem = mesh(ring(rimR, .35), 'deep', canopy, { outline: false })
      hem.rotation.x = pi / 2; hem.position.y = rim * U
      const dropGeometry = ball(.28, 6, 4)
      for (let i = 0; i < 26; i++) drops.push(mesh(dropGeometry, 'cyan', g, { outline: false, alpha: .75 }))
      return finish(P => {
        const open = P.open == null ? 1 : clamp(P.open), rain = clamp(P.rain || 0), t = P.t || 0,
          length = clamp(P.dropLength == null ? 90 : P.dropLength, 20, 180)
        canopy.scale.set(.06 + .94 * open, .3 + .7 * open, .06 + .94 * open)
        canopy.position.y = (1 - open) * 23 * U
        folded.visible = open < .6
        folded.scale.set(1 + open * 2.5, 1 - open * .25, 1 + open * 2.5)
        for (let i = 0; i < drops.length; i++) {
          const drop = drops[i], phase = (t * (.8 + hash(i + 2) * .35) + hash(i + 7)) % 1,
            side = i % 2 ? -1 : 1, a = hash(i + 17) * tau,
            spread = rimR * (.9 + hash(i + 13) * .45), y = 65 - phase * (length + 33)
          drop.visible = rain > .02 && open > .65
          drop.position.set((Math.cos(a) * spread + side * 1.4 * phase) * U, y * U, Math.sin(a) * spread * U)
          drop.scale.setScalar(.7 + .3 * rain); drop.scale.y *= 3.3
          // Внутри купола дождь перехватывается панелями, сбоку продолжает падение.
          if (y < 49 && y > rim - 1 && Math.abs(Math.cos(a) * spread) < rimR * .82) drop.visible = false
        }
        drops[0].material.uniforms.uOpacity.value *= rain
      })
    },

    abilitySnowflake() {
      const { g, mesh, rod, finish } = build(), crystal = new T.Group()
      g.add(crystal)
      mesh(ball(1.1, 8, 6), 'white', crystal)
      for (let i = 0; i < 6; i++) {
        const a = i * tau / 6, x = Math.cos(a), y = Math.sin(a)
        rod([0, 0, 0], [x * 7, y * 7, 0], .36, 'cyan', crystal)
        for (const side of [-1, 1]) {
          const b = a + side * pi / 3
          rod([x * 3.7, y * 3.7, 0], [x * 3.7 + Math.cos(b) * 2.6, y * 3.7 + Math.sin(b) * 2.6, .18], .25, 'white', crystal,
            { outline: false })
        }
      }
      const contactMeshes = []; crystal.traverse(o => { if (o.isMesh && o.material?.uniforms?.uBase) contactMeshes.push(o) })
      return finish(P => {
        const melt = clamp(P.melt || 0), held = P.supportOrientation ?? P.handContact?.amount ?? 0, t = P.t || 0
        // В ладони кристалл опирается одной ветвью; свободное вращение возобновляется после отпускания.
        crystal.rotation.set(.2 + Math.sin(t * 1.3) * .12 * (1 - held), t * .5 * (1 - held) + .3 * held,
          (P.spin || 0) * (1 - held) + (pi / 6 + .04 * Math.sin(t)) * held)
        crystal.scale.setScalar(Math.max(.03, 1 - melt * .9))
      }, contactMeshes)
    },

    abilityStar() {
      const { g, mesh, finish } = build(), star = new T.Group()
      g.add(star)
      const solid = mesh(beveledStar(7, 2.1), 'gold', star)
      const inset = mesh(beveledStar(4.9, .24), 'white', star, { alpha: .34, outline: false })
      inset.position.z = 1.12 * U
      return finish(P => {
        const held = P.supportOrientation ?? P.handContact?.amount ?? 0, t = P.t || 0
        star.rotation.set(.1, Math.sin(t * 1.4) * .2, (P.spin || 0) * (1 - held) + (pi / 5 + .04 * Math.sin(t)) * held)
      }, [solid])
    },

    abilityOrbit() {
      const { g, mesh, finish } = build(), system = new T.Group(), planets = [], paths = []
      g.add(system)
      mesh(ball(2.4, 12, 8), 'gold', system)
      for (let i = 0; i < 3; i++) {
        const pivot = new T.Group(); pivot.rotation.set(.5 + i * .4, i * .8, i * .55); system.add(pivot)
        const path = mesh(ring(7 + i * 4.1, .18), 'metal', pivot, { alpha: .35, outline: false, depthWrite: false })
        const planet = mesh(ball(i === 2 ? 1.8 : 1.3, 10, 7), ['blue', 'lime', 'cyan'][i], pivot)
        planets.push(planet); paths.push(path)
        if (i === 2) { const saturn = mesh(ring(2.7, .36), 'white', planet, { outline: false }); saturn.rotation.x = .9 }
      }
      return finish(P => {
        const time = P.clock == null ? (P.t || 0) * (P.speed == null ? 1 : clamp(P.speed, 0, 3)) : P.clock,
          radius = clamp(P.radius == null ? 1 : P.radius, .4, 2)
        for (let i = 0; i < planets.length; i++) {
          const a = time * (1.1 - i * .22) + i * 2.1, r = (7 + i * 4.1) * U * radius
          planets[i].position.set(Math.cos(a) * r, Math.sin(a) * r, 0)
          paths[i].scale.setScalar(radius)
        }
      })
    },

    abilityCrate() {
      const { g, mesh, finish } = build(), crate = new T.Group()
      crate.name = 'crate-body'; g.add(crate)
      const body = mesh(kit.rbox(22.8, 23.2, 22.8, .6), 'wood', crate)
      body.position.y = 12 * U
      // Четыре выступающие доски обрамляют переднюю грань, остальные продолжаются на боку и крышке.
      for (const side of [-1, 1]) {
        const horizontal = mesh(kit.rbox(24, 2.6, .7, .15), 'woodRail', crate)
        horizontal.position.set(0, (12 + side * 10.7) * U, 11.65 * U)
        const vertical = mesh(kit.rbox(2.6, 18.8, .7, .15), 'woodRail', crate)
        vertical.position.set(side * 10.7 * U, 12 * U, 11.65 * U)
        const sideRail = mesh(kit.rbox(.7, 2.6, 23, .15), 'woodRail', crate)
        sideRail.position.set(11.65 * U, (12 + side * 10.7) * U, 0)
        const lidRail = mesh(kit.rbox(2.6, .7, 23, .15), 'woodRail', crate)
        lidRail.position.set(side * 10.7 * U, 23.65 * U, 0)
        const seam = mesh(kit.rbox(18.6, .2, .15, .06), 'woodGroove', crate, { outline: false })
        seam.position.set(0, (12 + side * 3.2) * U, 11.46 * U)
      }
      return finish(P => { crate.rotation.x = clamp(P.tilt || 0, -pi / 2, pi / 2) })
    },

    abilityForceWall() {
      const { g, mesh, rod, finish } = build(), pane = new T.Group(), pulses = []
      g.add(pane)
      const solid = mesh(kit.rbox(25, 42, 1.4, 2), 'cyan', pane, { alpha: .2, depthWrite: false, outline: false })
      const corners = [[-12.5, -21, 0], [12.5, -21, 0], [12.5, 21, 0], [-12.5, 21, 0]]
      for (let i = 0; i < 4; i++) {
        const a = corners[i], b = corners[(i + 1) % 4]
        rod(a, b, .56, 'blue', pane)
        const rivet = mesh(ball(.9, 7, 5), 'lime', pane, { outline: false }); rivet.position.copy(vec(...a))
      }
      for (let i = 0; i < 3; i++) {
        const pulse = mesh(ring(3 + i * 2.4, .3), i ? 'cyan' : 'white', pane,
          { alpha: .6, outline: false, depthWrite: false })
        pulse.position.z = 1.1 * U; pulses.push(pulse)
      }
      const reflection = mesh(kit.rbox(2.2, 31, .12, .5), 'white', pane, { alpha: .16, depthWrite: false, outline: false })
      reflection.position.set(-7.8 * U, 0, .9 * U); reflection.rotation.z = -.14
      return finish(P => {
        const impact = clamp(P.impact || 0), t = P.t || 0
        pane.rotation.y = Math.sin(t * 26) * impact * .06
        for (let i = 0; i < pulses.length; i++) {
          pulses[i].visible = impact > .03
          pulses[i].scale.setScalar(.3 + impact * (1 + i * .12))
        }
      }, [solid])
    },

    abilityTimeBubble() {
      const { g, mesh, finish } = build(), shell = new T.Group(), fragments = [], tracks = []
      shell.name = 'time-shell'
      g.add(shell)
      mesh(ball(18, 18, 12), 'cyan', shell, { alpha: .1, outline: false, depthWrite: false })
      for (let i = 0; i < 2; i++) {
        const band = mesh(ring(18, .26), 'white', shell, { alpha: .55, outline: false, depthWrite: false })
        band.rotation.set(i * .8, i ? .6 : pi / 2, i * .4); tracks.push(band)
      }
      const shardGeometry = kit.rbox(2.2, 3.8, .8, .18)
      for (let i = 0; i < 12; i++) fragments.push(mesh(shardGeometry, ['blue', 'metal', 'gold'][i % 3], g))
      return finish(P => {
        const t = P.clock == null ? P.t || 0 : P.clock, freeze = clamp(P.freeze || 0),
          radius = clamp(P.radius == null ? 18 : P.radius, 18, 64), extent = radius / 18,
          fragmentScale = clamp(P.fragmentScale == null ? 1 : P.fragmentScale, 1, 3.5)
        for (let i = 0; i < fragments.length; i++) {
          const a = t * .6 + i * 2.4, x = (i * 8.7 % 104) - 52 + (t - 1.5) * (100 + hash(i) * 30)
          fragments[i].position.set(x * U * extent, (hash(i + 18) - .5) * 26 * U * extent, (hash(i + 31) - .5) * 24 * U * extent)
          fragments[i].visible = Math.abs(x) < 56
          fragments[i].scale.setScalar(fragmentScale * clamp((56 - Math.abs(x)) / 8))
          fragments[i].rotation.set(a * .8, a * 1.3, i + a * .2)
        }
        tracks[0].rotation.z = t * .1; tracks[1].rotation.z = -t * .13
        shell.scale.setScalar(extent * (.94 + .06 * freeze))
        shell.visible = freeze > .01
      })
    },

    abilityForceWave() {
      const { g, mesh, finish } = build(), waves = [], sonic = [], sonicRims = []
      for (let i = 0; i < 3; i++) {
        waves.push(mesh(ring(6 + i * 1.5, .6), ['cyan', 'blue', 'white'][i], g,
          { alpha: .5, outline: false, depthWrite: false }))
        const m = mesh(new T.SphereGeometry(U, 18, 9, 0, tau, 0, pi / 2), 'cyan', g,
          { alpha: .22 - i * .02, outline: false, depthWrite: false, side: 2 })
        m.name = 'sonic-front-' + i
        m.rotation.x = pi / 2; sonic.push(m)
        sonicRims.push(mesh(ring(1, .075), 'deep', g,
          { alpha: .62 - i * .04, outline: false, depthWrite: false }))
      }
      return finish(P => {
        const spread = clamp(P.spread || 0), sound = P.kind === 'sonic'
        for (let i = 0; i < waves.length; i++) {
          const u = clamp(spread * 1.4 - i * .13), scale = .45 + u * 1.85
          waves[i].visible = !sound && u > .01
          waves[i].position.z = (4 + u * 43) * U; waves[i].scale.setScalar(scale)
          const phase = clamp(spread * 1.65 - i * .23), frontRadius = 4 + phase * 25,
            visible = sound && phase > .005 && phase < .995,
            envelope = Math.min(1, phase / .12) * Math.min(1, (1 - phase) / .24)
          sonic[i].visible = sonicRims[i].visible = visible
          sonic[i].position.z = sonicRims[i].position.z = (4 + phase * 82) * U
          sonic[i].scale.setScalar(frontRadius); sonicRims[i].scale.setScalar(frontRadius)
          sonic[i].material.uniforms.uOpacity.value *= envelope
          sonicRims[i].material.uniforms.uOpacity.value *= envelope
        }
      })
    },

    abilityFlashlight() {
      const { g, mesh, finish } = build(), light = new T.Group(), beams = []
      g.add(light)
      const body = mesh(kit.rcyl(1.3, 1.2, 8.5, .35), 'dark', light)
      body.rotation.x = pi / 2; body.position.z = -2 * U
      const head = mesh(kit.rcyl(2.4, 1.25, 3.2, .4), 'metal', light)
      head.rotation.x = pi / 2; head.position.z = 3.7 * U
      const rim = mesh(ring(2.2, .35), 'blue', light); rim.position.z = 5.8 * U
      const lens = mesh(cylinder(1.85, 1.85, .22, 14), 'white', light, { outline: false })
      lens.rotation.x = pi / 2; lens.position.z = 6 * U
      const button = mesh(kit.rbox(1, .4, 1.4, .15), 'lime', light); button.position.set(0, 1.2 * U, -1.6 * U)
      for (let i = 0; i < 2; i++) {
        const beam = mesh(new T.CylinderGeometry(1, .045, 1, 18, 1, true), i ? 'white' : 'gold', g,
          { alpha: i ? .035 : .06, outline: false, depthWrite: false, side: 2 })
        beam.rotation.x = pi / 2; beams.push(beam)
      }
      return finish(P => {
        const amount = clamp(P.beam == null ? 1 : P.beam), length = clamp(P.beamLength == null ? 65 : P.beamLength, 12, 8000),
          radius = clamp(P.beamRadius == null ? 12 : P.beamRadius, 3, 80)
        for (let i = 0; i < beams.length; i++) {
          const m = beams[i], width = radius * (i ? .62 : 1) * U
          m.visible = amount > .01
          m.scale.set(width, length * U * amount, width)
          m.position.z = (6.4 + length * amount / 2) * U
        }
        for (const m of beams) m.material.uniforms.uOpacity.value *= amount
      })
    },

    abilityConfetti() {
      const { g, mesh, finish } = build(), pieces = [], paper = (width, height, thickness) => {
        // Низкополигональная бумага с толщиной: 16 треугольников вместо округлого rbox на каждую ленту.
        const geometry = new T.CylinderGeometry(1, 1, 1, 4, 1)
        geometry.rotateY(pi / 4); geometry.scale(width * U / Math.SQRT2, thickness * U, height * U / Math.SQRT2)
        geometry.rotateX(pi / 2); return geometry
      }, ribbon = paper(3, 7, .22), square = paper(4, 4, .28), colors = ['blue', 'lime', 'gold', 'red', 'cyan', 'white']
      for (let i = 0; i < 96; i++) pieces.push(mesh(i % 3 ? ribbon : square, colors[i % colors.length], g, { outline: false }))
      return finish(P => {
        const t = P.burst == null ? Math.max(0, P.t || 0) : clamp(P.burst) * 3.5,
          floorDrop = Math.max(0, P.floorDrop == null ? 120 : P.floorDrop), gravity = 96
        for (let i = 0; i < pieces.length; i++) {
          const speed = 26 + hash(i + 9) * 58, a = hash(i + 2) * tau,
            vx = Math.cos(a) * speed, vz = Math.sin(a) * speed * .55, vy = 46 + hash(i + 4) * 54,
            landAt = (vy + Math.sqrt(vy * vy + 2 * gravity * floorDrop)) / gravity,
            clock = Math.min(t, landAt), landed = t >= landAt
          pieces[i].position.set((vx * clock * .7 + Math.sin(clock * 3 + i) * clock * 2) * U,
            (landed ? -floorDrop + .3 + (i % 3) * .08 : vy * t - gravity * t * t / 2) * U, vz * clock * U)
          pieces[i].rotation.set(landed ? pi / 2 : t * (1 + hash(i)) * 4 + i, landed ? 0 : t * 1.8 + i,
            landed ? i * 2.4 : t * 2.3 + i)
          pieces[i].scale.setScalar(1)
          pieces[i].visible = true
        }
      })
    }
  }
}
