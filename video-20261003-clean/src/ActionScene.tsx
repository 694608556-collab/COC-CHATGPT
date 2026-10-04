import React from 'react'
import { AbsoluteFill, Easing, Img, interpolate, staticFile, useCurrentFrame } from 'remotion'
import type { ActionShot, ActionStep, Box } from './timeline-v2'

const STAGE = { x: 112, y: 63, w: 1696, h: 954 }
const SCALE = STAGE.w / 1920
const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value))
const ease = (t: number): number => Easing.inOut(Easing.cubic)(clamp(t, 0, 1))
const center = (box: Box): { x: number; y: number } => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 })

const Cursor: React.FC<{ x: number; y: number; opacity: number; pressed: number }> = ({ x, y, opacity, pressed }) => (
  <svg viewBox="0 0 52 66" style={{
    position: 'absolute', left: x - 3, top: y - 2, width: 25, height: 32, opacity,
    transform: `scale(${1 - pressed * 0.08})`, transformOrigin: '3px 2px',
    filter: 'drop-shadow(0 2px 3px rgba(0,0,0,.34))', zIndex: 40
  }}>
    <path d="M7 4v45l11-10 9 21 9-4-9-20h17z" fill="#fff" stroke="#101217" strokeWidth="4" strokeLinejoin="round" />
  </svg>
)

const appPoint = (point: { x: number; y: number }): { x: number; y: number } => ({
  x: STAGE.x + point.x * SCALE,
  y: STAGE.y + point.y * SCALE,
})

const actionAt = (shot: ActionShot, frame: number): { action: ActionStep; local: number; index: number; start: number } => {
  let start = 0
  for (let index = 0; index < shot.actions.length; index += 1) {
    const action = shot.actions[index]
    if (frame < start + action.duration || index === shot.actions.length - 1) return { action, local: frame - start, index, start }
    start += action.duration
  }
  return { action: shot.actions[shot.actions.length - 1], local: 0, index: shot.actions.length - 1, start }
}

export const ActionScene: React.FC<{ shot: ActionShot; shotIndex: number; duration: number }> = ({ shot, shotIndex, duration }) => {
  const frame = useCurrentFrame()
  const { action, local, index } = actionAt(shot, frame)
  const kind = action.kind ?? 'click'
  const moveEnd = 32
  const typeStart = 38
  const typeEnd = kind === 'type' ? Math.min(action.duration - 70, typeStart + Math.max(24, (action.query?.length ?? 1) * 8)) : 0
  const switchAt = kind === 'type' ? typeEnd + 10 : kind === 'progress' ? 68 : kind === 'scroll' ? 52 : kind === 'hold' ? action.duration + 1 : 45
  // UI states with different dialog geometry must never be cross-faded: blending two
  // complete screenshots produces a duplicated, apparently misregistered interface.
  // A click-driven hard state change is also closer to how the real application behaves.
  const cross = local >= switchAt ? 1 : 0
  const statusOpacity = interpolate(local, [switchAt + 2, switchAt + 14], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic)
  })
  const sceneIn = interpolate(frame, [0, 16], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  const sceneOut = interpolate(frame, [duration - 16, duration], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  const target = center(action.target)
  const previous = index > 0 ? center(shot.actions[index - 1].target) : (shotIndex % 2 === 0 ? { x: 390, y: 865 } : { x: 1500, y: 850 })
  const move = ease(local / moveEnd)
  const u = 1 - move
  const cp1 = { x: previous.x + (target.x - previous.x) * 0.36, y: previous.y - 80 }
  const cp2 = { x: target.x - (target.x - previous.x) * 0.18, y: target.y + 55 }
  const cursorApp = {
    x: u * u * u * previous.x + 3 * u * u * move * cp1.x + 3 * u * move * move * cp2.x + move * move * move * target.x,
    y: u * u * u * previous.y + 3 * u * u * move * cp1.y + 3 * u * move * move * cp2.y + move * move * move * target.y,
  }
  const cursor = appPoint(cursorApp)
  const cursorOpacity = ['scroll', 'hold', 'progress'].includes(kind) ? 0 : interpolate(local, [0, 9, action.duration - 18, action.duration], [0, 1, 1, 0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp'
  })
  const clickFrame = kind === 'type' ? typeEnd + 5 : 39
  const pressed = ['click', 'double-click'].includes(kind)
    ? interpolate(local, [clickFrame - 3, clickFrame, clickFrame + 5], [0, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
    : 0
  const focus = action.focus ?? action.target
  const focusIn = interpolate(local, [moveEnd - 5, moveEnd + 10], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic)
  })
  const focusOut = interpolate(local, [switchAt - 3, switchAt + 8], [1, 0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp'
  })
  const focusOpacity = ['progress', 'scroll', 'hold'].includes(kind) ? 0 : Math.min(focusIn, focusOut)
  // A detached magnified copy is useful for compact controls on the main page, but it
  // becomes visually misleading inside dialogs/search panels because it duplicates and
  // clips the modal. Large, typed, scrolling and progress regions therefore use only the
  // correctly registered target outline on the original, aspect-preserved screenshot.
  const lensEnabled = false
  const focusCenter = center(focus)
  const zoom = focus.width > 800 || focus.height > 700 ? 1.04 : focus.width > 400 ? 1.12 : 1.28
  const lensW = Math.min(STAGE.w - 30, Math.max(220, focus.width * SCALE * zoom + 24))
  const lensH = Math.min(STAGE.h - 30, Math.max(96, focus.height * SCALE * zoom + 24))
  const lensCx = STAGE.x + focusCenter.x * SCALE
  const lensCy = STAGE.y + focusCenter.y * SCALE
  const lensX = clamp(lensCx - lensW / 2, STAGE.x + 8, STAGE.x + STAGE.w - lensW - 8)
  const lensY = clamp(lensCy - lensH / 2, STAGE.y + 8, STAGE.y + STAGE.h - lensH - 8)
  const imageLeft = lensW / 2 - focusCenter.x * SCALE * zoom
  const imageTop = lensH / 2 - focusCenter.y * SCALE * zoom
  const typed = kind === 'type' ? clamp(Math.floor((local - typeStart) / 8) + 1, 0, action.query?.length ?? 0) : 0
  const typing = kind === 'type' && local >= typeStart && local < switchAt
  const rippleT = clamp((local - clickFrame) / 22, 0, 1)
  const rippleVisible = ['click', 'double-click'].includes(kind) && local >= clickFrame && local <= clickFrame + 22

  return (
    <AbsoluteFill style={{
      overflow: 'hidden', opacity: Math.min(sceneIn, sceneOut),
      background: 'radial-gradient(1050px 520px at 82% 5%,rgba(111,73,255,.13),transparent 68%), radial-gradient(820px 500px at 4% 76%,rgba(145,154,178,.17),transparent 72%), linear-gradient(135deg,#f2f3f6 0%,#e6e8ed 48%,#d9dde5 100%)',
      fontFamily: '"Microsoft YaHei", "PingFang SC", sans-serif'
    }}>
      <div style={{
        position: 'absolute', left: STAGE.x, top: STAGE.y, width: STAGE.w, height: STAGE.h,
        overflow: 'hidden', borderRadius: 16, background: '#e8e9ee',
        boxShadow: '0 16px 42px rgba(45,50,64,.21)', outline: '1px solid rgba(95,103,122,.18)'
      }}>
        <Img src={staticFile(action.from)} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain' }} />
        <Img src={staticFile(action.to)} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain', opacity: cross }} />
      </div>

      <div style={{
        position: 'absolute', left: STAGE.x + action.target.x * SCALE - 5, top: STAGE.y + action.target.y * SCALE - 5,
        width: action.target.width * SCALE + 10, height: action.target.height * SCALE + 10,
        border: '2px solid rgba(111,73,255,.82)', borderRadius: action.target.width > 260 ? 12 : 9,
        boxShadow: '0 0 0 5px rgba(111,73,255,.10)', opacity: focusOpacity, zIndex: 18
      }} />

      {lensEnabled ? <div style={{
        position: 'absolute', left: lensX, top: lensY, width: lensW, height: lensH, overflow: 'hidden',
        border: '1.5px solid rgba(111,73,255,.64)', borderRadius: 13, background: '#fff',
        boxShadow: '0 12px 30px rgba(55,42,101,.20)', opacity: focusOpacity,
        transform: `scale(${0.975 + focusIn * 0.025})`, zIndex: 20
      }}>
        <Img src={staticFile(action.from)} style={{ position: 'absolute', left: imageLeft, top: imageTop, width: STAGE.w * zoom, height: STAGE.h * zoom, maxWidth: 'none' }} />
      </div> : null}

      {typing ? (
        <div style={{
          position: 'absolute', left: STAGE.x + action.target.x * SCALE + 3, top: STAGE.y + action.target.y * SCALE + 3,
          width: action.target.width * SCALE - 6, height: action.target.height * SCALE - 6,
          paddingLeft: 8, boxSizing: 'border-box', borderRadius: 5, background: '#fff',
          display: 'flex', alignItems: 'center', color: '#353a45',
          fontSize: Math.max(15, action.target.height * SCALE * 0.46), fontWeight: 500, zIndex: 31,
          textShadow: '0 1px 0 #fff'
        }}>
          <span>{action.query?.slice(0, typed)}</span>
          <span style={{ width: 2, height: Math.max(16, action.target.height * SCALE * 0.55), marginLeft: 2, background: '#6f49ff' }} />
        </div>
      ) : null}

      {action.redact ? (
        <div style={{
          position: 'absolute', left: STAGE.x + action.redact.x * SCALE, top: STAGE.y + action.redact.y * SCALE,
          width: action.redact.width * SCALE, height: action.redact.height * SCALE,
          display: 'flex', alignItems: 'center', paddingLeft: 8, boxSizing: 'border-box',
          borderRadius: 5, background: '#eef0f4', color: '#5c6472', fontSize: 12,
          // The replacement belongs to the underlying settings field. Once the
          // action switches to a modal state it must be covered by that modal,
          // rather than floating above it as an unrelated strip.
          opacity: 1 - cross, zIndex: 32
        }}>{action.redactText ?? '虚拟数据'}</div>
      ) : null}

      {action.status ? (
        <div style={{
          position: 'absolute',
          right: STAGE.x + 26,
          top: STAGE.y + STAGE.h - 78,
          minWidth: 210,
          height: 44,
          padding: '0 18px',
          boxSizing: 'border-box',
          border: '1px solid rgba(88,74,160,.22)',
          borderRadius: 10,
          background: 'rgba(255,255,255,.97)',
          boxShadow: '0 8px 24px rgba(38,42,56,.16)',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          color: '#303442',
          fontSize: 17,
          fontWeight: 600,
          opacity: statusOpacity,
          zIndex: 34,
        }}>
          <span style={{ color: '#6f49ff', fontSize: 20 }}>✓</span>
          <span>{action.status}</span>
        </div>
      ) : null}

      {rippleVisible ? (
        <div style={{
          position: 'absolute', left: cursor.x - (22 + rippleT * 58) / 2, top: cursor.y - (22 + rippleT * 58) / 2,
          width: 22 + rippleT * 58, height: 22 + rippleT * 58, borderRadius: '50%',
          border: '2px solid rgba(111,73,255,.78)', opacity: (1 - rippleT) * 0.8, zIndex: 35
        }} />
      ) : null}
      <Cursor x={cursor.x} y={cursor.y} opacity={cursorOpacity} pressed={pressed} />

      <div style={{
        position: 'absolute', left: '50%', bottom: 9, transform: 'translateX(-50%)', width: 1380,
        color: '#252833', fontSize: 30, lineHeight: 1.25, fontWeight: 600, letterSpacing: 0.1,
        textAlign: 'center', whiteSpace: 'nowrap',
        textShadow: '0 1px 0 rgba(255,255,255,.95),0 2px 7px rgba(255,255,255,.88)'
      }}>{action.caption}</div>
      <div style={{
        position: 'absolute', left: 30, bottom: 16, color: '#555d6c', fontSize: 17,
        lineHeight: 1, fontWeight: 600, letterSpacing: 0.2, textShadow: '0 1px 0 rgba(255,255,255,.9)'
      }}>采用虚拟数据生成</div>
    </AbsoluteFill>
  )
}
