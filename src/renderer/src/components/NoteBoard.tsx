import { useEffect, useState } from 'react'
import type { ModuleRecord, NoteImage, NoteRecord } from '../../../shared/types'
import { ConfirmDialog, type ConfirmOptions } from './ConfirmDialog'
import { PlusIcon, XIcon } from './Icons'
import { NameSuggestField } from './NameSuggestField'

interface NoteDraft {
  id?: string
  moduleName: string
  content: string
  noteDate: string
  images: NoteImage[]
}

function today(): string {
  const date = new Date()
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function toDraft(note: NoteRecord): NoteDraft {
  return {
    id: note.id,
    moduleName: note.moduleName,
    content: note.content,
    noteDate: note.noteDate,
    images: note.images
  }
}

function mediaUrl(image: NoteImage): string {
  return `coc-media://${image.path}`
}

export function NoteBoard({
  notes,
  modules,
  creating,
  onCreatingHandled,
  onStartCreating,
  onChanged,
  onNotice
}: {
  notes: NoteRecord[]
  modules: ModuleRecord[]
  creating: boolean
  onCreatingHandled(): void
  onStartCreating(): void
  onChanged(): Promise<void>
  onNotice(text: string): void
}): React.JSX.Element {
  const [draft, setDraft] = useState<NoteDraft>()
  const [busy, setBusy] = useState(false)
  const [confirmOptions, setConfirmOptions] = useState<ConfirmOptions>()

  useEffect(() => {
    if (!creating) return
    setDraft({ moduleName: '', content: '', noteDate: today(), images: [] })
    onCreatingHandled()
  }, [creating, onCreatingHandled])

  const save = async (): Promise<void> => {
    if (!draft || busy) return
    setBusy(true)
    try {
      const payload = {
        moduleName: draft.moduleName.trim(),
        content: draft.content,
        noteDate: draft.noteDate || today(),
        images: draft.images
      }
      if (draft.id) await window.coc.notes.update(draft.id, payload)
      else await window.coc.notes.create(payload)
      setDraft(undefined)
      await onChanged()
      onNotice('闲记已保存')
    } catch (error) {
      onNotice(error instanceof Error ? error.message : '闲记保存失败')
    } finally {
      setBusy(false)
    }
  }

  const requestDelete = (target: NoteDraft): void => {
    setConfirmOptions({
      title: '删除闲记',
      text: '删除这条闲记？其中的图片也会一并删除。',
      confirmLabel: '确认删除',
      danger: true,
      onConfirm: async () => {
        if (target.id) await window.coc.notes.delete(target.id)
        setDraft(undefined)
        await onChanged()
        onNotice('闲记已删除')
      }
    })
  }

  const addImages = async (): Promise<void> => {
    if (!draft) return
    try {
      const added = await window.coc.files.chooseNoteImage()
      if (added.length) setDraft({ ...draft, images: [...draft.images, ...added] })
    } catch (error) {
      onNotice(error instanceof Error ? error.message : '插入图片失败')
    }
  }

  const pasteImages = async (event: React.ClipboardEvent<HTMLTextAreaElement>): Promise<void> => {
    if (!draft) return
    const files = Array.from(event.clipboardData?.files ?? []).filter((file) =>
      file.type.startsWith('image/')
    )
    if (!files.length) return
    event.preventDefault()
    try {
      const added: NoteImage[] = []
      for (const file of files) {
        const bytes = new Uint8Array(await file.arrayBuffer())
        added.push(await window.coc.files.pasteNoteImage({ name: file.name || '粘贴图片.png', bytes }))
      }
      setDraft({ ...draft, images: [...draft.images, ...added] })
    } catch (error) {
      onNotice(error instanceof Error ? error.message : '粘贴图片失败')
    }
  }

  const removeImage = (path: string): void => {
    if (!draft) return
    setDraft({ ...draft, images: draft.images.filter((image) => image.path !== path) })
  }

  const empty = !draft && notes.length === 0

  return (
    <>
      {empty ? (
        <div className="empty-state">
          <h2>还没有闲记</h2>
          <p>记录跑团中有趣的讨论和自己的想法，可插入文字和图片。</p>
          <button className="primary" onClick={onStartCreating}>
            新建第一条闲记
          </button>
        </div>
      ) : (
        <div className="note-grid">
      {draft && (
        <article className="note-card note-card-editing">
          <header className="note-card-head">
            <NameSuggestField
              label="模组名称"
              value={draft.moduleName}
              options={modules.map((module) => module.name)}
              onChange={(next) => setDraft({ ...draft, moduleName: next })}
            />
            <label className="note-date-field">
              日期
              <input
                type="date"
                value={draft.noteDate}
                onChange={(event) => setDraft({ ...draft, noteDate: event.target.value })}
              />
            </label>
          </header>
          <div className="note-card-body">
            <textarea
              className="note-textarea"
              aria-label="闲记内容"
              rows={6}
              value={draft.content}
              onPaste={(event) => void pasteImages(event)}
              onChange={(event) => setDraft({ ...draft, content: event.target.value })}
            />
            {draft.images.length > 0 && (
              <div className="note-image-list">
                {draft.images.map((image) => (
                  <div className="note-image-item" key={image.path}>
                    <img src={mediaUrl(image)} alt={image.name} />
                    <button
                      className="icon-button neutral-delete"
                      aria-label={`删除图片 ${image.name}`}
                      onClick={() => removeImage(image.path)}
                    >
                      <XIcon />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <button className="secondary inline-add add-note-image" onClick={() => void addImages()}>
              <PlusIcon /> 插入图片
            </button>
          </div>
          <footer className="note-card-actions">
            <button className="text-button danger" onClick={() => requestDelete(draft)}>
              删除
            </button>
            <span className="spacer" />
            <button className="secondary" disabled={busy} onClick={() => setDraft(undefined)}>
              取消
            </button>
            <button className="primary" disabled={busy} onClick={() => void save()}>
              保存
            </button>
          </footer>
        </article>
      )}

      {/* 正在编辑的那条不再重复渲染成卡片：0.6.3 之前它会被原样再画一遍，
          看起来像旁边多出一个“修改前版本”。 */}
      {notes
        .filter((note) => note.id !== draft?.id)
        .map((note) => (
          <article className="note-card" key={note.id}>
            <header className="note-card-head">
              <span className="note-module">{note.moduleName || '未关联模组'}</span>
              <span className="note-date">{note.noteDate}</span>
            </header>
            <button
              className="note-card-main"
              aria-label={`编辑闲记 ${note.noteDate}`}
              onClick={() => setDraft(toDraft(note))}
            >
              <span className="note-content">{note.content || '（空白闲记）'}</span>
              {note.images.length > 0 && (
                <span className="note-thumbs">
                  {note.images.slice(0, 3).map((image) => (
                    <img key={image.path} src={mediaUrl(image)} alt={image.name} />
                  ))}
                  {note.images.length > 3 && <span className="note-more">+{note.images.length - 3}</span>}
                </span>
              )}
            </button>
            <footer className="note-card-actions">
              <button className="text-button danger" onClick={() => requestDelete(toDraft(note))}>
                删除
              </button>
            </footer>
          </article>
        ))}
        </div>
      )}

      {confirmOptions && (
        <ConfirmDialog options={confirmOptions} onClose={() => setConfirmOptions(undefined)} />
      )}
    </>
  )
}
