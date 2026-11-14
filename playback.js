/** Сценарии идут по модельному времени и завершению всей очереди движка. */
export function createPlayback({ raw, registry, launch, context, lookAt, changed }) {
  let current = null, launching = false
  const seconds = (value, max = 300) => {
    if (!Number.isFinite(value) || value < 0 || value > max) throw new RangeError(`Duration must be between 0 and ${max} seconds`)
  }, validate = steps => {
    if (!Array.isArray(steps) || !steps.length || steps.length > 128) throw new TypeError('A story requires 1 to 128 steps')
    return steps.map(step => {
      if (typeof step === 'string') step = { play: step }
      if (!step || typeof step !== 'object' || Array.isArray(step)) throw new TypeError('Expected a play, lookAt or wait step')
      if (['play', 'lookAt', 'wait'].filter(key => Object.hasOwn(step, key)).length !== 1) throw new TypeError('A step must contain exactly one action: play, lookAt or wait')
      if (Object.hasOwn(step, 'play')) {
        if (!registry.has(step.play)) throw new RangeError(`Unknown action: ${step.play}`)
        if (step.contextId !== undefined && step.contextId !== null && typeof step.contextId !== 'string') throw new TypeError('contextId must be a string or null')
        if (step.play === 'nap') {
          seconds(step.duration)
          if (step.duration < 3) throw new RangeError('Set a nap duration between 3 and 300 seconds')
        } else if (step.duration !== undefined) throw new TypeError('play duration is supported only for nap')
        return Object.freeze({ play: step.play, contextId: step.contextId, duration: step.duration })
      }
      if (Object.hasOwn(step, 'wait')) { seconds(step.wait); return Object.freeze({ wait: step.wait }) }
      const target = step.lookAt
      if (!target || ![target.x, target.y, target.z ?? 0].every(Number.isFinite)) throw new TypeError('lookAt expects a finite point {x,y,z?}')
      seconds(step.duration, 60)
      if (step.duration < .05) throw new RangeError('Set a gaze duration between 0.05 and 60 seconds')
      return Object.freeze({ lookAt: Object.freeze({ x: target.x, y: target.y, z: target.z ?? 0 }), duration: step.duration })
    })
  }, finish = (job, status, reason) => {
    if (current !== job) return
    current = null
    job.signal?.removeEventListener('abort', job.abort)
    if (job.gaze) lookAt(null)
    if (job.selection) {
      try { context.select(job.previousContext) } catch { context.select(null) }
    }
    job.resolve(Object.freeze({ status, step: job.index, ...(reason ? { reason } : {}) }))
    changed()
  }, advance = job => {
    if (current !== job) return
    if (job.cancelled) { finish(job, 'cancelled', job.cancelled); return }
    if (job.index >= job.steps.length) { finish(job, 'completed'); return }
    const step = job.steps[job.index]
    try {
      job.command = null; job.until = null; job.gaze = false
      if (step.play) {
        if (step.contextId !== undefined) { job.selection = true; context.select(step.contextId) }
        launching = true
        let accepted
        try { accepted = launch(step.play, step.duration) } finally { launching = false }
        if (current !== job) return
        if (!accepted) { finish(job, raw.reduced ? 'skipped' : 'failed', raw.reduced ? 'reduced-motion' : 'declined'); return }
        job.command = raw.command().id
      } else {
        if (step.lookAt) { lookAt(null); lookAt(step.lookAt, step.duration); job.gaze = true }
        job.until = raw.state().time + (step.wait ?? step.duration)
      }
    } catch (error) { finish(job, 'failed', error.message) }
  }, cancel = (job, reason = 'cancelled') => {
    if (current !== job || job.cancelled) return
    job.cancelled = reason
    if (job.command === null || raw.command().status !== 'running') finish(job, 'cancelled', reason)
    else raw.finishRest()
  }, unsubscribe = raw.subscribe(event => {
    const job = current
    if (!job || launching) return
    if (event.type === 'interrupt') {
      finish(job, event.reason === 'reduced-motion' ? 'skipped' : 'cancelled', event.reason)
      return
    }
    if (event.type !== 'frame') return
    if (job.command !== null) {
      const command = raw.command()
      if (command.id !== job.command || command.status === 'cancelled') { finish(job, 'cancelled', command.reason || 'replaced'); return }
      if (command.status === 'running') return
    } else if (event.time + 1e-9 < job.until) return
    if (job.gaze) lookAt(null)
    job.index++
    advance(job)
  })
  return {
    get running() { return !!current },
    start(input, { signal } = {}) {
      const steps = validate(input)
      if (signal && (typeof signal.addEventListener !== 'function' || typeof signal.removeEventListener !== 'function')) throw new TypeError('signal must be an AbortSignal')
      if (signal?.aborted || raw.reduced) return Object.freeze({
        finished: Promise.resolve(Object.freeze({ status: signal?.aborted ? 'cancelled' : 'skipped', step: 0, reason: signal?.aborted ? 'aborted' : 'reduced-motion' })), cancel() {}
      })
      if (current) finish(current, 'cancelled', 'replaced')
      let resolve
      const finished = new Promise(done => { resolve = done }), job = {
        steps, index: 0, command: null, until: null, resolve, signal,
        previousContext: context.snapshot().selectedId, selection: false, gaze: false,
        abort: () => cancel(job, 'aborted')
      }
      current = job
      signal?.addEventListener('abort', job.abort, { once: true })
      changed(); advance(job)
      return Object.freeze({ finished, cancel: () => cancel(job) })
    },
    cancel() { if (current) cancel(current) },
    stop(reason) { if (current) finish(current, 'cancelled', reason) },
    destroy() { if (current) finish(current, 'cancelled', 'destroyed'); unsubscribe() }
  }
}
