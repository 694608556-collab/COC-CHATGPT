import React from 'react'
import { AbsoluteFill, Audio, Sequence, interpolate, staticFile, useCurrentFrame } from 'remotion'
import { BrandScene } from './BrandScene'
import { ActionScene } from './ActionScene'
import { FEATURE_DURATION, OPENING_DURATION, OUTRO_DURATION, SFX_CUES, SHOTS, SHOT_DURATIONS, TOTAL_FRAMES } from './timeline-v2'

export const Main: React.FC<{ bgm?: boolean }> = ({ bgm = true }) => {
  const frame = useCurrentFrame()
  const bgmVolume = interpolate(frame, [0, 90, TOTAL_FRAMES - 120, TOTAL_FRAMES], [0, 0.27, 0.27, 0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp'
  })
  let from = OPENING_DURATION

  return (
    <AbsoluteFill style={{ backgroundColor: '#e5e8ee' }}>
      <Sequence from={0} durationInFrames={OPENING_DURATION}>
        <BrandScene duration={OPENING_DURATION} />
      </Sequence>
      {SHOTS.map((shot, index) => {
        const shotFrom = from
        const duration = SHOT_DURATIONS[shot.id]
        from += duration
        return (
          <Sequence key={shot.id} from={shotFrom} durationInFrames={duration}>
            <ActionScene shot={shot} shotIndex={index} duration={duration} />
          </Sequence>
        )
      })}
      <Sequence from={OPENING_DURATION + FEATURE_DURATION} durationInFrames={OUTRO_DURATION}>
        <BrandScene duration={OUTRO_DURATION} outro />
      </Sequence>

      {bgm ? <Audio src={staticFile('audio/bgm.mp3')} volume={bgmVolume} /> : null}
      {SFX_CUES.map((cue, index) => (
        <Sequence key={`${cue.from}-${index}`} from={cue.from} durationInFrames={cue.duration}>
          <Audio src={staticFile(cue.src)} volume={cue.volume} />
        </Sequence>
      ))}
      <Sequence from={OPENING_DURATION + FEATURE_DURATION + 75} durationInFrames={150}>
        <Audio src={staticFile('audio/sparkle.mp3')} volume={0.10} />
      </Sequence>
    </AbsoluteFill>
  )
}
