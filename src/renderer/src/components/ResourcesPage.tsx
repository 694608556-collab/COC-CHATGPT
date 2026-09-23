import { useEffect, useMemo, useState } from 'react'
import type { MindmapPreviewApi } from '../../../shared/api'
import type { ModuleRecord, ModuleResource, ModuleResourceKind } from '../../../shared/types'
import { FolderIcon, RefreshIcon, SolidTriangleIcon, XIcon } from './Icons'
import { ConfirmDialog, type ConfirmOptions } from './ConfirmDialog'
import { DialogShell } from './DialogShell'
import { MindmapViewer } from './MindmapViewer'

/**
 * 资料汇总页。
 *
 * 把 EdrawMind 导图、Notion 等网页链接、其他本地文件收拢成一份索引，
 * 按模组分组显示。定位是「索引」而不是编辑器 —— 软件只登记路径、显示预览、
 * 提供跳转，真正的编辑仍在 EdrawMind / Notion / 对应的办公软件里进行。
 *
 * 0.7.0：归属不再是每张卡片底部的下拉，改为「新建时点选 + 拖拽调整」，
 * 卡片保持桌面图标那样干净。
 */
export function ResourcesPage({
  modules,
  resources,
  hiddenModules,
  creating,
  onCreatingHandled,
  onChanged,
  onNotice
}: {
  modules: ModuleRecord[]
  resources: ModuleResource[]
  /** 已在资料汇总页被移除的模组 id（只影响本页显示） */
  hiddenModules: string[]
  /** 页头按下了「+ 导图/链接/文件」 */
  creating?: ModuleResourceKind
  onCreatingHandled(): void
  onChanged(): Promise<void>
  onNotice(text: string): void
}): React.JSX.Element {
  const [draft, setDraft] = useState<{
    kind: ModuleResourceKind
    moduleId: string
    title: string
    path: string
    url: string
    note: string
  }>()
  const [busy, setBusy] = useState(false)
  const [confirmOptions, setConfirmOptions] = useState<ConfirmOptions>()
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [missing, setMissing] = useState<Set<string>>(new Set())
  const [preview, setPreview] = useState<{ resource: ModuleResource; data: MindmapPreviewApi }>()
  const [icons, setIcons] = useState<Record<string, string>>({})
  const [thumbs, setThumbs] = useState<Record<string, string>>({})
  // 新版 EdrawMind 保存的导图读不出图形时，用对话框把原因和做法讲清楚
  const [formatNotice, setFormatNotice] = useState<{ resource: ModuleResource; message: string }>()
  // 拖拽中的资料 id，以及当前悬停的分组（用于高亮落点）
  const [dragging, setDragging] = useState<string>()
  const [dropTarget, setDropTarget] = useState<string>()

  // 分组：每个模组一组，未归属的单独一组放在最下面。
  // hiddenResourceModules 里的模组已被用户从本页移除，不再显示分组。
  const groups = useMemo(() => {
    const hidden = new Set(hiddenModules)
    const byModule = modules
      .filter((module) => !hidden.has(module.id))
      .map((module) => ({
        key: module.id,
        name: module.name,
        resources: resources.filter((resource) => resource.moduleId === module.id)
      }))
    const unassigned = resources.filter((resource) => !resource.moduleId)
    return { byModule, unassigned }
  }, [modules, resources, hiddenModules])

  const filePaths = useMemo(
    () => resources.map((resource) => resource.path).filter((value): value is string => Boolean(value)),
    [resources]
  )
  const pathKey = filePaths.join('|')

  // 只记路径、不复制文件，所以要核对文件是否还在，失效的标出来
  useEffect(() => {
    if (!filePaths.length) {
      setMissing(new Set())
      return
    }
    let cancelled = false
    void window.coc.resources
      .checkPaths(filePaths)
      .then((results) => {
        if (cancelled) return
        const gone = new Set<string>()
        filePaths.forEach((item, index) => {
          if (!results[index]) gone.add(item)
        })
        setMissing(gone)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [pathKey])

  // 取系统真实图标（docx 显示 Word 图标、pdf 显示 PDF 图标），像桌面图标那样
  useEffect(() => {
    if (!filePaths.length) {
      setIcons({})
      return
    }
    let cancelled = false
    void window.coc.resources
      .fileIcons(filePaths)
      .then((results) => {
        if (cancelled) return
        const map: Record<string, string> = {}
        filePaths.forEach((item, index) => {
          const icon = results[index]
          if (icon) map[item] = icon
        })
        setIcons(map)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [pathKey])

  /**
   * 图片缩略图。
   *
   * 走 readImage 而不是 coc-media 协议：那个协议只允许访问程序自己的
   * data/notes 目录，而资料图片在用户自己的目录里，会 404 显示成破图。
   */
  useEffect(() => {
    const images = resources.filter(
      (resource) => resource.kind === 'file' && isImagePath(resource.path)
    )
    if (!images.length) {
      setThumbs({})
      return
    }
    let cancelled = false
    void Promise.all(
      images.map(async (resource) => {
        try {
          return [resource.id, await window.coc.resources.readImage(resource.path!)] as const
        } catch {
          return [resource.id, ''] as const
        }
      })
    ).then((entries) => {
      if (cancelled) return
      const map: Record<string, string> = {}
      for (const [id, data] of entries) if (data) map[id] = data
      setThumbs(map)
    })
    return () => {
      cancelled = true
    }
  }, [resources.map((r) => `${r.id}:${r.path ?? ''}`).join('|')])

  const startCreate = (kind: ModuleResourceKind): void => {
    setDraft({ kind, moduleId: '', title: '', path: '', url: '', note: '' })
  }

  // 页头按下的按钮通过 creating 传进来；处理完立刻回调清掉，避免重复弹表单
  useEffect(() => {
    if (!creating) return
    startCreate(creating)
    onCreatingHandled()
  }, [creating])

  const pickFile = async (): Promise<void> => {
    if (!draft) return
    try {
      const picked = await window.coc.resources.chooseFiles(draft.kind)
      if (!picked.length) return
      const first = picked[0]!
      setDraft({ ...draft, path: first.path, title: draft.title || first.title })
      // 导图选完立刻试读一次：新版 EdrawMind 的文件读不出图形，
      // 这时就告诉用户该导出 HTML，别等他双击预览才发现。
      if (draft.kind === 'mindmap') {
        try {
          await window.coc.resources.readMindmap(first.path)
        } catch (error) {
          const message = error instanceof Error ? error.message : ''
          if (message.includes('私有格式') || (message.includes('导出') && message.includes('HTML'))) {
            setFormatNotice({
              resource: {
                id: '',
                kind: 'mindmap',
                title: draft.title || first.title,
                path: first.path,
                sortOrder: 0,
                createdAt: '',
                updatedAt: ''
              },
              message
            })
          }
        }
      }
    } catch (error) {
      onNotice(error instanceof Error ? error.message : '选择文件失败')
    }
  }

  const save = async (): Promise<void> => {
    if (!draft) return
    if (draft.kind === 'link' && !draft.url.trim()) {
      onNotice('请填写链接地址')
      return
    }
    if (draft.kind !== 'link' && !draft.path.trim()) {
      onNotice('请先选择文件')
      return
    }
    setBusy(true)
    try {
      await window.coc.resources.create({
        ...(draft.moduleId ? { moduleId: draft.moduleId } : {}),
        kind: draft.kind,
        title: draft.title.trim(),
        ...(draft.kind === 'link' ? { url: draft.url.trim() } : { path: draft.path.trim() }),
        ...(draft.note.trim() ? { note: draft.note.trim() } : {})
      })
      setDraft(undefined)
      await onChanged()
      onNotice('资料已添加')
    } catch (error) {
      onNotice(error instanceof Error ? error.message : '添加失败')
    } finally {
      setBusy(false)
    }
  }

  /** 双击打开：导图进预览器，其余交给系统 */
  const openResource = async (resource: ModuleResource): Promise<void> => {
    try {
      if (resource.kind === 'mindmap') {
        if (!resource.path) return
        const data = await window.coc.resources.readMindmap(resource.path)
        setPreview({ resource, data })
        return
      }
      await window.coc.resources.open(resource.id)
    } catch (error) {
      const message = error instanceof Error ? error.message : '无法打开'
      // 新版 EdrawMind（12.x）保存的导图是私有二进制格式，软件读不出图形。
      // 这个提示比较长、也需要用户照做，所以用对话框而不是顶部一闪而过的通知。
      if (message.includes('私有格式') || message.includes('导出') && message.includes('HTML')) {
        setFormatNotice({ resource, message })
        return
      }
      onNotice(message)
    }
  }

  /** 用 EdrawMind 打开这个导图，让用户去导出 HTML */
  const openMindmapSource = async (resource: ModuleResource): Promise<void> => {
    try {
      await window.coc.resources.open(resource.id)
    } catch (error) {
      onNotice(error instanceof Error ? error.message : '无法打开 EdrawMind')
    }
  }

  const openInOriginalApp = async (resource: ModuleResource): Promise<void> => {
    try {
      await window.coc.resources.open(resource.id)
    } catch (error) {
      onNotice(error instanceof Error ? error.message : '无法打开原程序')
    }
  }

  /** 更新资料：重新选一个文件，指向它 */
  const updateResource = async (resource: ModuleResource): Promise<void> => {
    try {
      const picked = await window.coc.resources.chooseReplacement(resource.id)
      if (!picked) return
      await window.coc.resources.relink(resource.id, picked.path, picked.title)
      await onChanged()
      onNotice('资料已更新')
    } catch (error) {
      onNotice(error instanceof Error ? error.message : '更新失败')
    }
  }

  const remove = (resource: ModuleResource): void => {
    setConfirmOptions({
      title: '移除资料',
      text: `从汇总里移除“${resource.title || resource.path || resource.url}”？不会删除原文件。`,
      confirmLabel: '确认移除',
      danger: true,
      onConfirm: async () => {
        try {
          await window.coc.resources.delete(resource.id)
          await onChanged()
          onNotice('资料已移除')
        } catch (error) {
          onNotice(error instanceof Error ? error.message : '移除失败')
        }
      }
    })
  }

  /**
   * 删除一个分组（模组分组与未归属分组逻辑一致）。
   *
   * 两个选项：
   * ① 清空资料 —— 只把资料从汇总里移除，分组保留（原文件不动）
   * ② 连分组一起删 —— 资料和这个分组条目都删掉
   *
   * 模组分组的「删除条目」只影响资料汇总页的显示：模组本身、场次、角色卡
   * 都不受影响（回到跑团记录页它照常在那儿）。
   */
  const removeGroup = (
    name: string,
    items: ModuleResource[],
    options: { moduleId?: string; unassigned?: boolean }
  ): void => {
    const count = items.length
    const clearOnly = async (): Promise<void> => {
      for (const resource of items) await window.coc.resources.delete(resource.id)
      await onChanged()
      onNotice(count ? `已清空「${name}」下 ${count} 条资料` : `「${name}」下没有资料`)
    }
    const removeWithGroup = async (): Promise<void> => {
      for (const resource of items) await window.coc.resources.delete(resource.id)
      // 模组分组还要记一笔「已从资料汇总页移除」，否则刷新后分组又会出现
      if (options.moduleId) await window.coc.resources.removeGroup(options.moduleId)
      await onChanged()
      onNotice(
        options.unassigned
          ? `已移除未归属分组的 ${count} 条资料`
          : `已从资料汇总移除「${name}」${count ? `及其 ${count} 条资料` : ''}`
      )
    }

    setConfirmOptions({
      title: `删除分组「${name}」`,
      text:
        count > 0
          ? `这个分组下有 ${count} 条资料。两个选项都不会删除你的原文件。`
          : '这个分组下还没有资料，删除后不再显示该分组。',
      confirmLabel: '只清空资料',
      danger: false,
      onConfirm: async () => {
        try {
          await clearOnly()
        } catch (error) {
          onNotice(error instanceof Error ? error.message : '操作失败')
        }
      },
      secondaryAction: {
        label: '连分组一起删',
        danger: true,
        onSelect: async () => {
          try {
            await removeWithGroup()
          } catch (error) {
            onNotice(error instanceof Error ? error.message : '操作失败')
          }
        }
      }
    })
  }

  const toggle = (key: string): void => {
    setCollapsed((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  /** 把资料拖到某个分组：改归属，并按落点顺序排进去 */
  const dropInto = async (moduleId: string | undefined, targetIndex?: number): Promise<void> => {
    const id = dragging
    setDragging(undefined)
    setDropTarget(undefined)
    if (!id) return
    const resource = resources.find((item) => item.id === id)
    if (!resource) return
    try {
      if ((resource.moduleId ?? undefined) !== moduleId) {
        await window.coc.resources.setModule(id, moduleId)
      }
      if (targetIndex !== undefined) {
        await window.coc.resources.move(id, targetIndex)
      }
      await onChanged()
    } catch (error) {
      onNotice(error instanceof Error ? error.message : '无法移动资料')
    }
  }

  const renderCard = (resource: ModuleResource, indexInGroup: number): React.JSX.Element => {
    const gone = resource.path ? missing.has(resource.path) : false
    const icon = resource.path ? icons[resource.path] : undefined
    const isImage = resource.kind === 'file' && isImagePath(resource.path)
    const thumb = thumbs[resource.id]
    const label = resource.title || resource.path || resource.url || '未命名资料'
    return (
      <div
        key={resource.id}
        className={gone ? 'resource-tile missing' : 'resource-tile'}
        title={gone ? '文件找不到了，可能已被移动或删除' : label}
        draggable
        onDragStart={() => setDragging(resource.id)}
        onDragEnd={() => {
          setDragging(undefined)
          setDropTarget(undefined)
        }}
        onDragOver={(event) => {
          if (!dragging || dragging === resource.id) return
          event.preventDefault()
          event.stopPropagation()
          setDropTarget(resource.id)
        }}
        onDrop={(event) => {
          event.preventDefault()
          event.stopPropagation()
          if (dragging && dragging !== resource.id) void dropInto(resource.moduleId, indexInGroup)
        }}
        onDoubleClick={() => void openResource(resource)}
      >
        <div className="resource-tile-preview">
          {isImage && thumb ? (
            <img className="resource-tile-image" src={thumb} alt={label} />
          ) : resource.kind === 'link' ? (
            <span className="resource-tile-link" aria-hidden="true">
              <LinkGlyph />
            </span>
          ) : icon ? (
            <img className="resource-tile-icon" src={icon} alt="" />
          ) : (
            <span className="resource-tile-fallback">
              {resource.kind === 'mindmap' ? <MindmapGlyph /> : <FileGlyph />}
            </span>
          )}
        </div>
        <span className="resource-tile-name">{label}</span>
        {gone && <span className="resource-tile-missing">找不到</span>}
        {/* 悬停才出现的操作：更新 / 用原程序打开 / 移除 */}
        <div className="resource-tile-actions">
          <button
            className="icon-button module-remove"
            title="更新（重新指定这个资料对应的文件）"
            aria-label={`更新 ${label}`}
            onClick={(event) => {
              event.stopPropagation()
              void updateResource(resource)
            }}
          >
            <RefreshIcon />
          </button>
          <button
            className="icon-button module-remove"
            title="用原程序打开"
            aria-label={`打开 ${label}`}
            onClick={(event) => {
              event.stopPropagation()
              void openInOriginalApp(resource)
            }}
          >
            <FolderIcon />
          </button>
          <button
            className="icon-button module-remove"
            title="从汇总里移除（不删除原文件）"
            aria-label={`移除 ${label}`}
            onClick={(event) => {
              event.stopPropagation()
              remove(resource)
            }}
          >
            <XIcon />
          </button>
        </div>
      </div>
    )
  }

  const renderGroup = (
    key: string,
    name: string,
    items: ModuleResource[],
    options: { unassigned?: boolean; module?: ModuleRecord } = {}
  ): React.JSX.Element => {
    const isCollapsed = collapsed.has(key)
    const isDropTarget = dropTarget === key
    return (
      <section
        className={
          'resource-group' +
          (options.unassigned ? ' unassigned' : '') +
          (isDropTarget ? ' drop-target' : '')
        }
        key={key}
        onDragOver={(event) => {
          if (!dragging) return
          event.preventDefault()
          setDropTarget(key)
        }}
        onDragLeave={() => setDropTarget((current) => (current === key ? undefined : current))}
        onDrop={(event) => {
          event.preventDefault()
          void dropInto(options.unassigned ? undefined : options.module?.id)
        }}
      >
        <header className="resource-group-head">
          <button
            className="collapse-button"
            aria-label={isCollapsed ? `展开 ${name}` : `收起 ${name}`}
            onClick={() => toggle(key)}
          >
            <SolidTriangleIcon className={isCollapsed ? 'collapsed' : ''} />
          </button>
          <span className="resource-group-name">{name}</span>
          <span className="count-badge">{items.length}</span>
          <span className="spacer" />
          {/* 模组分组与未归属分组用同一套删除逻辑：清空资料 / 连分组一起删 */}
          {options.module ? (
            <button
              className="icon-button module-remove"
              title="删除这个分组"
              aria-label={`删除分组 ${name}`}
              onClick={() =>
                removeGroup(name, items, { moduleId: options.module!.id })
              }
            >
              <XIcon />
            </button>
          ) : (
            <button
              className="icon-button module-remove"
              title="删除这个分组"
              aria-label="删除未归属分组"
              onClick={() => removeGroup(name, items, { unassigned: true })}
            >
              <XIcon />
            </button>
          )}
        </header>
        {!isCollapsed &&
          (items.length ? (
            <div className="resource-grid">
              {items.map((resource, index) => renderCard(resource, index))}
            </div>
          ) : (
            <p className="resource-group-empty">
              {options.unassigned
                ? '没有未归属的资料。把资料拖到这里即可取消归属。'
                : '这个模组还没有资料。添加时可以选它作为归属，也可以把资料拖进来。'}
            </p>
          ))}
      </section>
    )
  }

  return (
    <>
      {draft && (
        <div className="resource-draft">
          <div className="resource-draft-kind">添加{kindLabel(draft.kind)}</div>
          {draft.kind === 'link' ? (
            <label className="resource-field">
              链接地址
              <input
                type="url"
                placeholder="https://www.notion.so/..."
                value={draft.url}
                onChange={(event) => setDraft({ ...draft, url: event.target.value })}
              />
            </label>
          ) : (
            <div className="resource-field resource-file-field">
              文件
              <button className="secondary" onClick={() => void pickFile()}>
                <FolderIcon /> 选择文件
              </button>
              <span className="resource-path" title={draft.path}>
                {draft.path || '尚未选择'}
              </span>
            </div>
          )}
          <label className="resource-field">
            归属模组
            <select
              value={draft.moduleId}
              onChange={(event) => setDraft({ ...draft, moduleId: event.target.value })}
            >
              <option value="">不归属任何模组</option>
              {modules.map((module) => (
                <option key={module.id} value={module.id}>
                  {module.name}
                </option>
              ))}
            </select>
          </label>
          <label className="resource-field">
            标题
            <input
              type="text"
              placeholder="留空则用文件名"
              value={draft.title}
              onChange={(event) => setDraft({ ...draft, title: event.target.value })}
            />
          </label>
          <label className="resource-field">
            备注
            <input
              type="text"
              placeholder="可选，例如这张图讲什么"
              value={draft.note}
              onChange={(event) => setDraft({ ...draft, note: event.target.value })}
            />
          </label>
          <div className="resource-draft-actions">
            <button className="secondary" disabled={busy} onClick={() => setDraft(undefined)}>
              取消
            </button>
            <button className="primary" disabled={busy} onClick={() => void save()}>
              保存
            </button>
          </div>
        </div>
      )}

      {/*
        只有「没有任何模组、也没有任何资料」时才显示空白引导页。
        若模组还在（哪怕它下面一条资料都没有），仍然显示分组——
        否则用户删空资料后连分组都看不到，也就没法把资料拖回去。
      */}
      {resources.length === 0 && modules.length === 0 && !draft && (
        <div className="empty-state">
          <h2>还没有资料</h2>
          <p>
            可以把 EdrawMind 导图、Notion 链接或其他文件挂到这里，编辑仍在原软件里进行。
            资料可以归属到某个模组，也可以不归属；拖动卡片即可改归属或排序。
          </p>
        </div>
      )}

      {(resources.length > 0 || modules.length > 0) && (
        <div className="resource-groups">
          {groups.byModule.map((group) =>
            renderGroup(group.key, group.name, group.resources, {
              module: modules.find((module) => module.id === group.key)
            })
          )}
          {/* 未归属的放最下面 */}
          {renderGroup('__unassigned__', '未归属模组', groups.unassigned, { unassigned: true })}
        </div>
      )}

      {preview && (
        <MindmapViewer
          resource={preview.resource}
          data={preview.data}
          modules={modules}
          onClose={() => setPreview(undefined)}
          onEdit={() => void openInOriginalApp(preview.resource)}
          onNotice={onNotice}
        />
      )}

      {confirmOptions && (
        <ConfirmDialog options={confirmOptions} onClose={() => setConfirmOptions(undefined)} />
      )}

      {/* 新版 EdrawMind 导图无法显示图形时的说明 */}
      {formatNotice && (
        <DialogShell title="这个导图需要先导出为 HTML" onClose={() => setFormatNotice(undefined)}>
          <div className="dialog-body">
            <p className="confirm-text">{formatNotice.message}</p>
            <p className="confirm-text">
              操作步骤：在 EdrawMind 里打开这张导图 → 文件 → 导出 → 选择
              <strong> HTML </strong>
              格式 → 把导出的 HTML 文件添加到「资料汇总」里。之后就能看到完整图形，也能在底部切换子页面。
            </p>
          </div>
          <footer className="modal-actions">
            <button className="secondary" onClick={() => setFormatNotice(undefined)}>
              知道了
            </button>
            {/* 还没保存的资料没有 id，无法走 open(id)；这时按钮只关闭说明 */}
            {formatNotice.resource.id && (
              <button
                className="primary"
                onClick={() => {
                  const resource = formatNotice.resource
                  setFormatNotice(undefined)
                  void openMindmapSource(resource)
                }}
              >
                现在打开 EdrawMind
              </button>
            )}
          </footer>
        </DialogShell>
      )}
    </>
  )
}

function isImagePath(value: string | undefined): boolean {
  return Boolean(value && /\.(png|jpe?g|gif|webp|bmp)$/i.test(value))
}

function kindLabel(kind: ModuleResourceKind): string {
  if (kind === 'mindmap') return '导图'
  if (kind === 'link') return '链接'
  return '文件'
}

/** 链接图标：与软件其他图标同一套线条风格 */
function LinkGlyph(): React.JSX.Element {
  return (
    <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
      <path d="M10.5 13.5a4 4 0 0 0 5.7 0l2.6-2.6a4 4 0 1 0-5.7-5.7l-1 1" />
      <path d="M13.5 10.5a4 4 0 0 0-5.7 0l-2.6 2.6a4 4 0 1 0 5.7 5.7l1-1" />
    </svg>
  )
}

function MindmapGlyph(): React.JSX.Element {
  return (
    <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
      <rect x="2.5" y="9.5" width="6" height="5" rx="1.5" />
      <rect x="15.5" y="3.5" width="6" height="4.5" rx="1.5" />
      <rect x="15.5" y="15.5" width="6" height="4.5" rx="1.5" />
      <path d="M8.5 12h3.5v-6h3.5M12 12v6h3.5" />
    </svg>
  )
}

function FileGlyph(): React.JSX.Element {
  return (
    <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
      <path d="M6 3h7l5 5v13H6z" />
      <path d="M13 3v5h5" />
    </svg>
  )
}
