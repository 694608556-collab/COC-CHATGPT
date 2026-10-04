import React from 'react'
import { AbsoluteFill, Easing, Img, interpolate, staticFile, useCurrentFrame } from 'remotion'

export const BrandScene: React.FC<{ duration: number; outro?: boolean }> = ({ duration, outro = false }) => {
  const frame = useCurrentFrame()
  const fadeIn = interpolate(frame, [0, 48], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic)
  })
  const fadeOut = interpolate(frame, [duration - 36, duration], [1, 0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.inOut(Easing.cubic)
  })
  const opacity = Math.min(fadeIn, fadeOut)
  const scale = interpolate(fadeIn, [0, 1], [0.94, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  const settle = Math.sin(Math.min(1, frame / 72) * Math.PI) * 2

  return (
    <AbsoluteFill style={{
      overflow: 'hidden',
      background: 'radial-gradient(900px 520px at 50% 42%, rgba(111,73,255,.12), transparent 72%), linear-gradient(145deg,#f3f4f7 0%,#e8eaf0 52%,#dde1e8 100%)',
      fontFamily: '"Microsoft YaHei", "PingFang SC", sans-serif'
    }}>
      <div style={{
        position: 'absolute', left: '50%', top: '50%',
        width: 1040, height: 590, marginLeft: -520, marginTop: -295,
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        opacity, transform: `translateY(${settle}px) scale(${scale})`
      }}>
        <Img
          src={staticFile('logo.png')}
          style={{ width: 225, height: 225, objectFit: 'contain', mixBlendMode: 'multiply' }}
        />
        <div style={{ marginTop: 28, color: '#242833', fontWeight: 750, fontSize: 78, letterSpacing: 3 }}>
          COC 跑团记录簿
        </div>
        <div style={{ marginTop: 18, color: '#697184', fontWeight: 600, fontSize: 24, letterSpacing: 7 }}>
          {outro ? '记录每一次探索，也保存每一条线索' : '跑团记录 · 调查员 · 资料 · 闲记'}
        </div>
      </div>
    </AbsoluteFill>
  )
}
