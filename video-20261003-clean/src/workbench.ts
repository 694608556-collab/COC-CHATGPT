import { Main } from './Main'
import { FeatureScene } from './FeatureScene'
import { BrandScene } from './BrandScene'
import { FEATURE_DURATION, FPS, HEIGHT, OPENING_DURATION, OUTRO_DURATION, SFX_CUES, SHOTS, SHOT_STARTS, TOTAL_FRAMES, WIDTH } from './timeline'

export const WORKBENCH = {
  name: 'COC 跑团记录簿 · 功能演示片',
  fps: FPS,
  width: WIDTH,
  height: HEIGHT,
  total: TOTAL_FRAMES,
  background: '#e5e8ee',
  revision: 'approved-clean-v1',
  shots: [
    { id: 'opening', label: '品牌开场', from: 0, duration: OPENING_DURATION, component: BrandScene, props: { duration: OPENING_DURATION } },
    ...SHOTS.map((shot, index) => ({
      id: shot.id,
      label: shot.label,
      from: SHOT_STARTS[shot.id],
      duration: shot.duration,
      component: FeatureScene,
      props: { shot, index },
      cardId: 'feature-scene',
      schema: [{ type: 'text', key: 'caption', label: '字幕', default: shot.caption }]
    })),
    { id: 'outro', label: '品牌收尾', from: OPENING_DURATION + FEATURE_DURATION, duration: OUTRO_DURATION, component: BrandScene, props: { duration: OUTRO_DURATION, outro: true } }
  ],
  transitions: [],
  captions: [],
  overlays: [],
  sfx: SFX_CUES.map((cue) => ({ from: cue.from, duration: 180, src: cue.src, volume: cue.volume })),
  bgm: [{ from: 0, duration: TOTAL_FRAMES, src: 'audio/bgm.mp3', volume: 0.27 }],
  original: Main
}
