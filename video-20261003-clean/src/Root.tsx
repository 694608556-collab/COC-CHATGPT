import React from 'react'
import { Composition } from 'remotion'
import { Main } from './Main'
import { FPS, HEIGHT, TOTAL_FRAMES, WIDTH } from './timeline-v2'

export const Root: React.FC = () => (
  <Composition
    id="COCLogbookPromo"
    component={Main}
    durationInFrames={TOTAL_FRAMES}
    fps={FPS}
    width={WIDTH}
    height={HEIGHT}
    defaultProps={{ bgm: true }}
  />
)
