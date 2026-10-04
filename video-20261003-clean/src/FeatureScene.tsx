import React from 'react'
import { AbsoluteFill, Easing, Img, interpolate, staticFile, useCurrentFrame } from 'remotion'
import type { Box, Shot } from './timeline'

const STAGE = { x: 112, y: 63, w: 1696, h: 954 }
const BASE_SCALE = STAGE.w / 1920

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value))
const ease = (t: number): number => Easing.inOut(Easing.cubic)(clamp(t, 0, 1))
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t
const center = (box: Box): { x: number; y: number } => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 })

const Cursor: React.FC<{ x: number; y: number; opacity: number; pressed: number }> = ({ x, y, opacity, pressed }) => (
  <svg
    viewBox="0 0 52 66"
    style={{
      position: 'absolute', left: x - 4, top: y - 3, width: 30, height: 38,
      opacity, transform: `scale(${1 - pressed * 0.08})`, transformOrigin: '4px 3px',
      filter: 'drop-shadow(0 2px 3px rgba(0,0,0,.34))', zIndex: 30
    }}
  >
    <path d="M7 4v45l11-10 9 21 9-4-9-20h17z" fill="#fff" stroke="#101217" strokeWidth="4" strokeLinejoin="round" />
  </svg>
)

export const FeatureScene: React.FC<{ shot: Shot; index: number }> = ({ shot, index }) => {
  const frame = useCurrentFrame()
  const t = frame / Math.max(1, shot.duration - 1)
  const entry = interpolate(frame, [0, 30], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic)
  })
  const exit = interpolate(frame, [shot.duration - 30, shot.duration], [1, 0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.inOut(Easing.cubic)
  })
  const sceneOpacity = Math.min(entry, exit)

  const target = center(shot.target)
  const result = center(shot.result ?? shot.target)
  const start = index % 2 === 0 ? { x: 310, y: 865 } : { x: 1540, y: 850 }
  // 所有镜头都使用固定 1 秒鼠标飞行，避免长镜头把鼠标速度等比例拖慢。
  const moveT = ease((frame - 45) / 60)
  const u = 1 - moveT
  const cp1 = { x: start.x + (target.x - start.x) * 0.34, y: start.y - 120 }
  const cp2 = { x: target.x - (target.x - start.x) * 0.16, y: target.y + 85 }
  const x1 = u * u * u * start.x + 3 * u * u * moveT * cp1.x + 3 * u * moveT * moveT * cp2.x + moveT * moveT * moveT * target.x
  const y1 = u * u * u * start.y + 3 * u * u * moveT * cp1.y + 3 * u * moveT * moveT * cp2.y + moveT * moveT * moveT * target.y
  const resultMoveStart = shot.typing ? 300 : 270
  const resultT = shot.after ? ease((frame - resultMoveStart) / 60) : 0
  const cursorAppX = lerp(x1, result.x, resultT)
  const cursorAppY = lerp(y1, result.y, resultT)
  const cursorX = STAGE.x + cursorAppX * BASE_SCALE
  const cursorY = STAGE.y + cursorAppY * BASE_SCALE
  const cursorOpacity = interpolate(frame, [20, 45, shot.duration - 80, shot.duration - 45], [0, 1, 1, 0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp'
  })
  const actionFrame = shot.typing ? 240 : 190
  const pressed = shot.typing ? 0 : interpolate(frame, [actionFrame - 5, actionFrame, actionFrame + 7], [0, 1, 0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp'
  })

  // 光标在 105f 完全停稳后，聚焦框才开始出现。
  const lensIn = interpolate(frame, [115, 145], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic)
  })
  const lensOutStart = shot.typing ? 230 : 195
  const lensOut = interpolate(frame, [lensOutStart, lensOutStart + 40], [1, 0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.inOut(Easing.cubic)
  })
  const lensOpacity = Math.min(lensIn, lensOut)
  const lensPad = 8
  const lensW = shot.target.width * BASE_SCALE * shot.zoom + lensPad * 2
  const lensH = shot.target.height * BASE_SCALE * shot.zoom + lensPad * 2
  const lensCx = STAGE.x + target.x * BASE_SCALE
  const lensCy = STAGE.y + target.y * BASE_SCALE
  const lensX = clamp(lensCx - lensW / 2, STAGE.x + 5, STAGE.x + STAGE.w - lensW - 5)
  const lensY = clamp(lensCy - lensH / 2, STAGE.y + 5, STAGE.y + STAGE.h - lensH - 5)
  const imageLeft = lensW / 2 - target.x * BASE_SCALE * shot.zoom
  const imageTop = lensH / 2 - target.y * BASE_SCALE * shot.zoom
  const resultStart = shot.typing ? 240 : 205
  const afterOpacity = shot.after ? interpolate(frame, [resultStart, resultStart + 45], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.inOut(Easing.cubic)
  }) : 0
  const handoffBlur = shot.after ? Math.sin(clamp((frame - resultStart) / 45, 0, 1) * Math.PI) * 1.5 : 0
  const rippleT = clamp((frame - actionFrame) / 28, 0, 1)
  const rippleOpacity = !shot.typing && frame >= actionFrame && frame <= actionFrame + 28 ? (1 - rippleT) * 0.72 : 0
  const rippleSize = 24 + rippleT * 80
  const query = shot.query ?? ''
  const typedCount = shot.typing ? clamp(Math.floor((frame - 155) / 18) + 1, 0, query.length) : 0
  const typingVisible = Boolean(shot.typing && frame >= 145 && afterOpacity < 0.98)
  const caretVisible = typingVisible && frame < 235 && (frame < 215 || Math.floor((frame - 215) / 12) % 2 === 0)

  return (
    <AbsoluteFill style={{
      overflow: 'hidden', opacity: sceneOpacity,
      background: 'radial-gradient(1050px 520px at 82% 5%,rgba(111,73,255,.13),transparent 68%), radial-gradient(820px 500px at 4% 76%,rgba(145,154,178,.17),transparent 72%), linear-gradient(135deg,#f2f3f6 0%,#e6e8ed 48%,#d9dde5 100%)',
      fontFamily: '"Microsoft YaHei", "PingFang SC", sans-serif'
    }}>
      <div style={{
        position: 'absolute', left: STAGE.x, top: STAGE.y, width: STAGE.w, height: STAGE.h,
        overflow: 'hidden', borderRadius: 16, background: '#e8e9ee',
        boxShadow: '0 16px 42px rgba(45,50,64,.21)', outline: '1px solid rgba(95,103,122,.18)',
        filter: `blur(${handoffBlur}px)`
      }}>
        <Img src={staticFile(shot.before)} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain' }} />
        {shot.after ? (
          <Img src={staticFile(shot.after)} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain', opacity: afterOpacity }} />
        ) : null}
      </div>

      {typingVisible ? (
        <>
          <div style={{
            position: 'absolute',
            left: lensX + lensPad + 2 * BASE_SCALE * shot.zoom,
            top: lensY + lensPad + 2 * BASE_SCALE * shot.zoom,
            width: shot.target.width * BASE_SCALE * shot.zoom - 4 * BASE_SCALE * shot.zoom,
            height: shot.target.height * BASE_SCALE * shot.zoom - 4 * BASE_SCALE * shot.zoom,
            borderRadius: 6 * BASE_SCALE * shot.zoom,
            background: '#fff', zIndex: 23, pointerEvents: 'none', opacity: 1
          }} />
          <div style={{
            position: 'absolute',
            left: lensX + lensPad + 12 * BASE_SCALE * shot.zoom,
            top: lensY + lensPad,
            height: shot.target.height * BASE_SCALE * shot.zoom,
            display: 'flex', alignItems: 'center', color: '#4d5360',
            fontSize: 13 * BASE_SCALE * shot.zoom, fontWeight: 400, zIndex: 24, pointerEvents: 'none', opacity: 1
          }}>
            <span>{query.slice(0, typedCount)}</span>
            <span style={{ width: 1.5, height: 16 * BASE_SCALE * shot.zoom, marginLeft: 2, background: '#6f49ff', opacity: caretVisible ? 1 : 0 }} />
          </div>
        </>
      ) : null}

      <div style={{
        position: 'absolute', left: lensX, top: lensY, width: lensW, height: lensH,
        overflow: 'hidden', border: '2px solid rgba(111,73,255,.82)',
        borderRadius: shot.target.width > 260 ? 16 : 11,
        background: '#fff', boxShadow: '0 0 0 6px rgba(111,73,255,.10),0 10px 28px rgba(55,42,101,.23)',
        opacity: lensOpacity, transform: `scale(${0.965 + lensIn * 0.035})`, zIndex: 18
      }}>
        <Img src={staticFile(shot.before)} style={{
          position: 'absolute', left: imageLeft, top: imageTop,
          width: STAGE.w * shot.zoom, height: STAGE.h * shot.zoom, maxWidth: 'none'
        }} />
      </div>

      <div style={{
        position: 'absolute', left: STAGE.x + target.x * BASE_SCALE - rippleSize / 2,
        top: STAGE.y + target.y * BASE_SCALE - rippleSize / 2,
        width: rippleSize, height: rippleSize, borderRadius: '50%', border: '2px solid rgba(111,73,255,.8)',
        opacity: rippleOpacity, zIndex: 26
      }} />
      <Cursor x={cursorX} y={cursorY} opacity={cursorOpacity} pressed={pressed} />

      <div style={{
        position: 'absolute', left: '50%', bottom: 9, transform: 'translateX(-50%)',
        width: 1380, color: '#252833', fontSize: 30, lineHeight: 1.25, fontWeight: 600,
        letterSpacing: 0.1, textAlign: 'center', whiteSpace: 'nowrap',
        textShadow: '0 1px 0 rgba(255,255,255,.95),0 2px 7px rgba(255,255,255,.88)'
      }}>
        {shot.caption}
      </div>
      <div style={{
        position: 'absolute', left: 30, bottom: 16, color: '#555d6c', fontSize: 17,
        lineHeight: 1, fontWeight: 600, letterSpacing: 0.2,
        textShadow: '0 1px 0 rgba(255,255,255,.9)'
      }}>
        采用虚拟数据生成
      </div>
    </AbsoluteFill>
  )
}
