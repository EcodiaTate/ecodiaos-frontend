/**
 * AMBIENT PALETTE - the visual language of CortexAmbient.
 *
 * Charcoal base. Selective high-contrast accents. NOT cyan-on-black Tron.
 * NOT translucent-blue Stark-knockoff.
 *
 * The signature accent is "ember", a desaturated copper-gold that sits at
 * roughly 28deg hue and pulls the eye without screaming. Cooler accents
 * (cyan, violet) play supporting roles around it - they encode meaning
 * (next_action_by colour), they don't carry the brand.
 */
export const AMBIENT_PALETTE = {
  base: '#06070a',      // background
  fog: '#0a0d12',       // mid-distance haze
  ambient: '#1a2030',   // ambient light tint
  coreGlow: '#ffb27a',  // ember - conductor presence colour (identity, do not replace with gold)
  emberSoft: '#e89060',
  emberDeep: '#9a4c28',
  // Phase 8: gold/yellow/green accent palette (replaces decorative orange-reds)
  gold: '#d4af37',          // deep warm gold - chip borders, panel dividers, accent lines
  brightAmber: '#f5c518',   // bright gold-yellow - highlights, sparklines
  acidGreen: '#c8f243',     // acid yellow-green - LIVE indicators, active signals
  sage: '#7a9a5a',          // solarpunk sage green - organic accents, watermarks
  moss: '#6b8e4e',          // deeper moss - gauge ticks, secondary organic elements
  cyan: '#5ad9c8',      // ecodiaos next_action_by
  amber: '#f0a847',     // tate next_action_by
  violet: '#a47cff',    // client next_action_by
  grey: '#5a6577',      // external next_action_by
  done: '#2c3140',      // archived / done
  error: '#e85a5a',     // error/aborted (functional - keep red)
  text: '#e8ecf2',
  textDim: '#7a8294',
} as const

/** Map next_action_by to colour. */
export function actionByColor(by: string | null | undefined): string {
  switch (by) {
    case 'ecodiaos': return AMBIENT_PALETTE.cyan
    case 'tate': return AMBIENT_PALETTE.amber
    case 'client': return AMBIENT_PALETTE.violet
    case 'external': return AMBIENT_PALETTE.grey
    default: return AMBIENT_PALETTE.textDim
  }
}

/** Map fork status to colour + intensity. */
export function forkStatusColor(status: string): { color: string; pulse: number } {
  switch (status) {
    case 'running':
    case 'reporting':
      return { color: AMBIENT_PALETTE.coreGlow, pulse: 1.0 }
    case 'spawning':
      return { color: AMBIENT_PALETTE.amber, pulse: 0.6 }
    case 'done':
      return { color: AMBIENT_PALETTE.cyan, pulse: 0.25 }
    case 'aborted':
    case 'error':
      return { color: AMBIENT_PALETTE.error, pulse: 0.4 }
    default:
      return { color: AMBIENT_PALETTE.textDim, pulse: 0.2 }
  }
}
