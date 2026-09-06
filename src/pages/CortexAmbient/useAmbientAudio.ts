/**
 * useAmbientAudio - subtle ambient synth via WebAudio.
 *
 * Default muted. When enabled, plays a very low-level drone whose
 * filter cutoff and detune respond to system state (here: number of
 * active forks). NOT music. NOT a "Jarvis voice". A breath under the
 * scene that lets you feel the OS is alive.
 *
 * We use raw WebAudio (no Tone.js dep) to keep the bundle small.
 * Spike scope: one drone + one ping on fork count change.
 */
import { useEffect, useRef } from 'react'

export function useAmbientAudio(enabled: boolean, intensity: number) {
  const ctxRef = useRef<AudioContext | null>(null)
  const droneRef = useRef<{ osc1: OscillatorNode; osc2: OscillatorNode; filter: BiquadFilterNode; gain: GainNode } | null>(null)
  const lastIntensityRef = useRef<number>(intensity)

  useEffect(() => {
    // When disabled, do nothing here - the cleanup function from the prior
    // enabled-effect run is the single tear-down path. Calling close() in
    // both branches caused a double-close ("Cannot close a closed AudioContext"
    // surfaces as Uncaught (in promise) InvalidStateError because
    // AudioContext.close() returns a Promise that rejects).
    if (!enabled) return

    const Ctor = (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)
    if (!Ctor) return
    const ctx = new Ctor()
    ctxRef.current = ctx

    const osc1 = ctx.createOscillator()
    osc1.type = 'sine'
    osc1.frequency.value = 60
    const osc2 = ctx.createOscillator()
    osc2.type = 'sine'
    osc2.frequency.value = 90.4 // slight detune for beating
    const filter = ctx.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.value = 280
    filter.Q.value = 0.6
    const gain = ctx.createGain()
    gain.gain.value = 0.0
    // Soft fade-in over 1.6s
    gain.gain.setTargetAtTime(0.045, ctx.currentTime, 0.5)

    osc1.connect(filter)
    osc2.connect(filter)
    filter.connect(gain)
    gain.connect(ctx.destination)
    osc1.start()
    osc2.start()
    droneRef.current = { osc1, osc2, filter, gain }

    return () => {
      // Single cleanup path: fade gain, then stop oscillators, then close ctx.
      // Each step is independently guarded - close() promise rejection is
      // caught instead of becoming "Uncaught (in promise) InvalidStateError".
      try {
        gain.gain.setTargetAtTime(0, ctx.currentTime, 0.4)
      } catch {}
      const closeTimer = setTimeout(() => {
        try { osc1.stop() } catch {}
        try { osc2.stop() } catch {}
        if (ctx.state !== 'closed') {
          ctx.close().catch(() => {})
        }
        if (ctxRef.current === ctx) {
          ctxRef.current = null
          droneRef.current = null
        }
      }, 600)
      // If unmount happens before the fade timer fires, kill the timer to
      // avoid the closeTimer running against an already-detached context.
      // (closeTimer reference kept so future cleanup-of-cleanup could clear it.)
      void closeTimer
    }
  }, [enabled])

  // Ping on intensity change (count delta)
  useEffect(() => {
    if (!enabled) return
    const ctx = ctxRef.current
    const drone = droneRef.current
    if (!ctx || !drone) {
      lastIntensityRef.current = intensity
      return
    }
    // Modulate filter cutoff to reflect intensity
    const target = 220 + intensity * 60
    drone.filter.frequency.setTargetAtTime(target, ctx.currentTime, 1.2)

    if (intensity !== lastIntensityRef.current) {
      // Tiny ping
      const ping = ctx.createOscillator()
      ping.type = 'sine'
      ping.frequency.value = 880
      const pgain = ctx.createGain()
      pgain.gain.value = 0
      pgain.gain.setTargetAtTime(0.018, ctx.currentTime, 0.02)
      pgain.gain.setTargetAtTime(0, ctx.currentTime + 0.18, 0.18)
      ping.connect(pgain).connect(ctx.destination)
      ping.start()
      ping.stop(ctx.currentTime + 0.7)
      lastIntensityRef.current = intensity
    }
  }, [enabled, intensity])
}
