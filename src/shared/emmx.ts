/**
 * EdrawMind（.emmx）解析：把导图转成矢量 SVG 与层级大纲。
 *
 * 为什么不用文件自带的 thumbnail.png：它只有 210px 左右，而导图内容区动辄
 * 5000×5000 以上（实测「龙台掠雪」内容区 5486×4913）。缩略图放大后完全糊成
 * 马赛克，一个字都认不出。所以改为读 page/page.xml 重建矢量图——矢量放大不糊。
 *
 * .emmx 是 zip 容器，只用到其中两类条目：
 * - page/page.xml、page/page-1.xml …  每个文件是一个画布
 * - document.xml                        取修改时间等元信息
 * 其余（theme.xml、rels、thumbnail、media）目前不用。
 *
 * 0.7.0 起线条按 EdrawMind 的真实几何绘制：
 * - MMConnector / RelatConnector 的 <Geometry> 里有 MoveTo/LineTo/CurveTo，
 *   直接转成 SVG path，曲线、直角折线都能还原（0.6.8 一律画直线，很难看）
 * - Boundary（分组框）、Summary（概括括号）、Callout（标注）同样是几何图形，
 *   一并画出来，否则导图里的归纳线条全都看不见
 */
import zlib from 'node:zlib'
import { AppError } from './errors'

/** zip 中央目录里我们关心的一条记录 */
interface ZipEntry {
  name: string
  method: number
  compressedSize: number
  dataStart: number
}

export interface EmmxShape {
  id: string
  type: string
  /** 左上角坐标与尺寸（已由中心点换算） */
  x: number
  y: number
  width: number
  height: number
  lines: string[]
  fontSize: number
  color: string
  fill: string
  stroke: string
  /**
   * 文字自己的区域（绝对坐标）。
   *
   * 0.7.0 修复：EdrawMind 给每个节点单独存了文字框，它的坐标是【相对节点框
   * 左上角】的偏移，尺寸也通常小于节点框（如 240×99 的框，文字区只有 199×67）。
   * 此前只按「居中于节点框」画，位置一直有偏差，文字会压到相邻节点。
   * 取不到文字框时为 undefined，渲染方退回居中处理。
   */
  textBox?: { x: number; y: number; width: number; height: number }
}

/** 一条用 SVG path 表达的线条（连接线、分组框、概括括号都用它） */
export interface EmmxPath {
  id: string
  /** SVG path 的 d 属性，坐标已换算成画布绝对坐标 */
  d: string
  stroke: string
  strokeWidth: number
  /** 分组框之类带填充；普通连接线为 none */
  fill: string
  /** 原始类型，便于调试与统计 */
  type: string
  /**
   * 连线的锚点（BeginPt / EndPt 的原始值）。
   *
   * 解析时先记下来，等整个画布的节点框都收集齐了，再统一把首尾点校正到框边
   * ——连线在 XML 里可能排在它连接的节点之前，边解析边校正会找不到框。
   */
  anchors?: { beginX: number; beginY: number; endX: number; endY: number }
}

/**
 * 浮在图形上的标签文字。
 *
 * 两类来源：关系连线的说明（「意图杀害」「母女」）和分组框的标题。
 * 它们的坐标语义不同，解析时已统一换算成绝对坐标。
 */
export interface EmmxLabel {
  /** 图形 id，渲染成 data-shape 供搜索定位 */
  id?: string
  x: number
  y: number
  width: number
  height: number
  lines: string[]
  fontSize: number
  color: string
}

export interface EmmxPage {
  /** 画布在文件里的条目名，如 page/page.xml */
  name: string
  /** 画布名，如「画布 1」 */
  title: string
  width: number
  height: number
  shapes: EmmxShape[]
  paths: EmmxPath[]
  labels: EmmxLabel[]
  /** 内容包围盒，用于只框住有内容的部分 */
  bounds: { minX: number; minY: number; maxX: number; maxY: number }
}

/** 大纲里的一行：文字 + 层级深度 */
export interface EmmxOutlineLine {
  text: string
  depth: number
}

export interface EmmxDocument {
  pages: EmmxPage[]
  /** 按层级排好的大纲 */
  outline: EmmxOutlineLine[]
  /** 文件里记录的修改时间（可能为空） */
  modifiedAt?: string
}

const ZIP_LOCAL_HEADER = 0x04034b50

/**
 * 扫描 zip 的本地文件头。
 *
 * 没有走中央目录，因为 .emmx 的条目顺序稳定、且我们只需要读，
 * 逐字节找魔数最简单可靠（不引入第三方 zip 依赖）。
 */
function readZipEntries(buffer: Buffer): ZipEntry[] {
  const entries: ZipEntry[] = []
  for (let i = 0; i < buffer.length - 4; i += 1) {
    if (buffer.readUInt32LE(i) !== ZIP_LOCAL_HEADER) continue
    const method = buffer.readUInt16LE(i + 8)
    const compressedSize = buffer.readUInt32LE(i + 18)
    const nameLength = buffer.readUInt16LE(i + 26)
    const extraLength = buffer.readUInt16LE(i + 28)
    if (nameLength === 0 || nameLength > 512) continue
    const name = buffer.subarray(i + 30, i + 30 + nameLength).toString('utf8')
    if (!name || name.includes('\u0000')) continue
    entries.push({ name, method, compressedSize, dataStart: i + 30 + nameLength + extraLength })
  }
  return entries
}

function readEntry(buffer: Buffer, entry: ZipEntry): Buffer {
  const raw = buffer.subarray(entry.dataStart, entry.dataStart + entry.compressedSize)
  if (entry.method === 0) return raw
  if (entry.method !== 8) {
    throw new AppError('EMMX_COMPRESSION', 'PARSE', '导图使用了不支持的压缩方式。')
  }
  try {
    return zlib.inflateRawSync(raw)
  } catch (error) {
    throw new AppError('EMMX_CORRUPT', 'PARSE', '导图内容已损坏，无法读取。', false, error)
  }
}

/** 取某个标签的 V 属性数值；找不到返回 undefined */
function numberTag(xml: string, tag: string): number | undefined {
  const match = xml.match(new RegExp(`<${tag}\\s+V="(-?[\\d.eE+]+)"`))
  if (!match) return undefined
  const value = Number(match[1])
  return Number.isFinite(value) ? value : undefined
}

/**
 * 读 document.xml 里记录的 EdrawMind 版本号。
 *
 * 8.x 存的导图是 page/page.xml（可解析），12.x 换成 mmpage/*.bin（不可解析），
 * 报错时带上版本号，用户就知道是软件升级导致的格式变化。
 */
function readDocumentVersion(buffer: Buffer, entries: ZipEntry[]): string | undefined {
  const entry = entries.find((item) => item.name === 'document.xml')
  if (!entry) return undefined
  try {
    const xml = readEntry(buffer, entry).toString('utf8')
    return (
      xml.match(/<Document\s+Version="([^"]*)"/)?.[1] ??
      xml.match(/<CreatedVersion\s+V="([^"]*)"/)?.[1]
    )
  } catch {
    return undefined
  }
}

function normalizeColor(value: string | undefined): string | undefined {
  if (!value) return undefined
  const hex = value.trim()
  // EdrawMind 用 #aarrggbb（带 alpha），SVG 用 #rrggbb
  if (/^#[0-9a-fA-F]{8}$/.test(hex)) return `#${hex.slice(3)}`
  if (/^#[0-9a-fA-F]{6}$/.test(hex)) return hex
  return undefined
}

/**
 * 把 <Geometries> 里的 MoveTo/LineTo/CurveTo 转成 SVG path。
 *
 * 几何坐标是相对本 Shape 的 Transform 中心点的偏移，所以要加上 origin。
 * CurveTo 的 A/B 是第一控制点、C/D 是第二控制点（三次贝塞尔）。
 */
function geometryToPath(body: string, originX: number, originY: number): string | undefined {
  const geometry = body.match(/<Geometry[^>]*>([\s\S]*?)<\/Geometry>/)
  if (!geometry) return undefined
  const segments: string[] = []
  const tokenPattern = /<(MoveTo|LineTo|CurveTo)>([\s\S]*?)<\/\1>/g
  let match: RegExpExecArray | null
  while ((match = tokenPattern.exec(geometry[1]!))) {
    const kind = match[1]!
    const inner = match[2]!
    const x = numberTag(inner, 'X')
    const y = numberTag(inner, 'Y')
    if (x === undefined || y === undefined) continue
    const px = originX + x
    const py = originY + y
    if (kind === 'MoveTo') {
      segments.push(`M${px} ${py}`)
    } else if (kind === 'LineTo') {
      segments.push(`L${px} ${py}`)
    } else {
      const a = numberTag(inner, 'A')
      const b = numberTag(inner, 'B')
      const c = numberTag(inner, 'C')
      const d = numberTag(inner, 'D')
      if ([a, b, c, d].some((value) => value === undefined)) {
        // 控制点不全就退化成直线，宁可少一段弧度也不能画错
        segments.push(`L${px} ${py}`)
      } else {
        /**
         * 兜底：SVG 要求路径必须以 M 开头，若几何以 CurveTo 起笔就直接写 C，
         * 浏览器会判为非法路径、整条线都不画（控制台报 "Expected moveto path command"）。
         *
         * 用曲线自己的【首控制点】补这个 M，而不是连线锚点：锚点与曲线起点可能
         * 差一段距离，用它当 M 会把整条曲线拉偏。实测三个真实文件里没有一条
         * 连线以曲线起笔（0 条），所以这只是防御性兜底，正常不会触发。
         */
        if (!segments.length) segments.push(`M${originX + a!} ${originY + b!}`)
        segments.push(
          `C${originX + a!} ${originY + b!} ${originX + c!} ${originY + d!} ${px} ${py}`
        )
      }
    }
  }
  return segments.length ? segments.join(' ') : undefined
}

/**
 * 读普通节点里文字自己的区域。
 *
 * 关键：这个 Transform 的 CX/CY 是【相对节点框左上角】的偏移（已用真实文件
 * 逐一验证：节点中心 1228.5 的节点，文字 CX 是 119.9，而节点框宽 240.2，
 * 119.9 ≈ 240.2/2，说明它相对的是左上角而不是画布）。
 * 尺寸也通常小于节点框，文字就在这个区域内按框宽折行。
 */
function readTextBox(
  body: string,
  nodeLeft: number,
  nodeTop: number
): { x: number; y: number; width: number; height: number } | undefined {
  const transform = body.match(/<Text>\s*<Transform>([\s\S]*?)<\/Transform>/)
  if (!transform) return undefined
  const t = transform[1]!
  const width = numberTag(t, 'Width')
  const height = numberTag(t, 'Height')
  const cx = numberTag(t, 'CX')
  const cy = numberTag(t, 'CY')
  if (width === undefined || height === undefined) return undefined
  // 没有 CX/CY 时按居中处理
  const centerX = cx === undefined ? width / 2 : cx
  const centerY = cy === undefined ? height / 2 : cy
  return {
    x: nodeLeft + centerX - width / 2,
    y: nodeTop + centerY - height / 2,
    width,
    height
  }
}

/** 从 path 的 d 里取出所有坐标点，用于算内容包围盒 */
function pathPoints(d: string): Array<{ x: number; y: number }> {
  const points: Array<{ x: number; y: number }> = []
  for (const token of d.split(/(?=[MLC])/)) {
    const numbers = token
      .slice(1)
      .trim()
      .split(/[\s,]+/)
      .map(Number)
      .filter((value) => Number.isFinite(value))
    for (let i = 0; i + 1 < numbers.length; i += 2) {
      points.push({ x: numbers[i]!, y: numbers[i + 1]! })
    }
  }
  return points
}

/**
 * 读一个 Shape 的标签文字。
 *
 * 两种坐标语义：
 * - 关系连线（RelatConnector）的 <Text><Transform> 是【相对连线锚点的偏移】，
 *   必须叠加锚点才能落到正确位置。这就是 0.6.8 里标签全部错位的原因。
 * - 分组框（Boundary）等自身就是容器的，文字用绝对坐标（isAbsolute）。
 *
 * 找不到文字框时返回 undefined（很多连线没有标签）。
 */
/**
 * 从 TextBlock 里取出文字行。
 *
 * 关键：**`<pp>` 才是一行（段落），`<tp>` 只是段内的文本片段**。
 * EdrawMind 会把同一行按格式差异切成多个 tp，例如
 *
 *   <pp PX="1" CX="0">
 *     <tp CX="0">应同渊娲一样，为</tp>
 *     <tp CX="1">某个计划</tp>
 *     <tp CX="0">的产物</tp>
 *   </pp>
 *
 * 这是**一行**（"应同渊娲一样，为某种计划的产物"），不是三行。
 * 0.7.2 及更早按 tp 收集，把它算成 3 行、需要的高度翻倍，于是文字被挤出
 * 节点框、压到相邻节点上——用户反馈的「文字框重叠」就是这里来的。
 *
 * 实测「世界回归进行曲」：942 个 tp 里只有 5 个节点是「单 pp 多 tp」，
 * 但正是这几个出现了溢出。按 pp 分组后行数正确。
 */
function readTextLines(textBlock: string): string[] {
  const lines: string[] = []
  const paragraphs = [...textBlock.matchAll(/<pp\b[^>]*>([\s\S]*?)<\/pp>/g)]
  // 没有 <pp> 包裹时（个别老文件）退回按 tp 收集，至少不丢文字
  const blocks = paragraphs.length ? paragraphs.map((item) => item[1]!) : [textBlock]
  for (const block of blocks) {
    const parts = [...block.matchAll(/<tp\b[^>]*>([\s\S]*?)<\/tp>/g)]
      .map((tp) => decodeXmlEntities(tp[1]!.replace(/<[^>]+>/g, '')))
      .join('')
      .trim()
    if (parts) lines.push(parts)
  }
  return lines
}

function readLabel(
  body: string,
  originX: number,
  originY: number,
  isAbsolute = false,
  id?: string
): EmmxLabel | undefined {
  const textBlock = body.match(/<TextBlock[^>]*>([\s\S]*?)<\/TextBlock>/)
  if (!textBlock) return undefined
  const lines = readTextLines(textBlock[1]!)
  if (!lines.length) return undefined

  let fontSize = 12
  let color = '#333333'
  const character = textBlock[1]!.match(/<Character[^>]*>/)
  if (character) {
    const size = character[0].match(/Size="([\d.]+)"/)
    const textColor = character[0].match(/Color="(#[0-9a-fA-F]{6,8})"/)
    if (size) fontSize = Number(size[1])
    const normalized = normalizeColor(textColor?.[1])
    if (normalized) color = normalized
  }

  // 文字框自身的 Transform：中心点 + 尺寸
  const textTransform = body.match(/<Text>\s*<Transform>([\s\S]*?)<\/Transform>/)
  let width = 0
  let height = 0
  let x = originX
  let y = originY
  if (textTransform) {
    const t = textTransform[1]!
    const w = numberTag(t, 'Width')
    const h = numberTag(t, 'Height')
    const cx = numberTag(t, 'CX')
    const cy = numberTag(t, 'CY')
    if (w !== undefined) width = w
    if (h !== undefined) height = h
    if (cx !== undefined && cy !== undefined) {
      // 相对偏移要叠加锚点；绝对坐标直接用
      x = isAbsolute ? cx : originX + cx
      y = isAbsolute ? cy : originY + cy
    }
  }
  return {
    ...(id === undefined ? {} : { id }),
    x: x - width / 2,
    y: y - height / 2,
    width: width || lines[0]!.length * fontSize * 0.6,
    height: height || lines.length * fontSize * 1.1,
    lines,
    fontSize,
    color
  }
}

/** 解析一个画布 */
function parsePage(entryName: string, xml: string): EmmxPage {
  const titleMatch = xml.match(/<Page\b[^>]*\bName="([^"]*)"/)
  const shapes: EmmxShape[] = []
  const paths: EmmxPath[] = []
  const labels: EmmxLabel[] = []

  const shapePattern = /<Shape\s+ID="(\d+)"\s+Type="([^"]+)"[^>]*>([\s\S]*?)<\/Shape>/g
  let match: RegExpExecArray | null
  while ((match = shapePattern.exec(xml))) {
    const id = match[1]!
    const type = match[2]!
    const body = match[3]!

    const transform = body.match(/<Transform>([\s\S]*?)<\/Transform>/)
    if (!transform) continue
    const t = transform[1]!
    const width = numberTag(t, 'Width')
    const height = numberTag(t, 'Height')
    const cx = numberTag(t, 'CX')
    const cy = numberTag(t, 'CY')
    if (cx === undefined || cy === undefined) continue

    const strokeWidth = numberTag(body, 'LineWeight') ?? 2
    const stroke =
      normalizeColor(
        body.match(/<LineFill[^>]*>\s*<Color[^>]*V="(#[0-9a-fA-F]{6,8})"/)?.[1]
      ) ?? '#8a8a8a'

    // 连接线：走真实几何，曲线/折线都能还原
    if (type === 'MMConnector' || type === 'RelatConnector') {
      const beginX = numberAttr(body, 'BeginPt', 'X')
      const beginY = numberAttr(body, 'BeginPt', 'Y')
      const endX = numberAttr(body, 'EndPt', 'X')
      const endY = numberAttr(body, 'EndPt', 'Y')
      // 原样还原几何；缺口由 bridgeStartGap 在节点框收集齐之后补
      const d = geometryToPath(body, cx, cy)
      if (d) {
        // 先记下 BeginPt / EndPt，等节点框收集齐了再统一校正端点
        paths.push({
          id,
          d,
          stroke,
          strokeWidth,
          fill: 'none',
          type,
          ...(beginX === undefined || beginY === undefined || endX === undefined || endY === undefined
            ? {}
            : { anchors: { beginX, beginY, endX, endY } })
        })
      }
      // 0.7.0 修复：关系连线（RelatConnector）自带标签，例如「意图杀害」「母女」「死敌」。
      // 0.6.8 把它们当普通连线，只画线、文字全丢——用户看到的「标注、概括归纳的线条
      // 都看不见」就是这个原因。
      //
      // 关键：标签的 Transform 是相对连线锚点的【偏移】，不是绝对坐标，
      // 必须叠加锚点 (cx, cy) 才能落到正确位置。
      const label = readLabel(body, cx, cy, false, id)
      if (label) labels.push(label)
      continue
    }

    // 分组框 / 概括括号 / 标注框：几何图形本身不画出来，归纳线条就全丢了
    if (type === 'Boundary' || type === 'Summary' || type === 'Callout') {
      if (width === undefined || height === undefined) continue
      const left = cx - width / 2
      const top = cy - height / 2
      const d = geometryToPath(body, left, top)
      if (d) {
        const fill = normalizeColor(
          body.match(/<FillFormat[^>]*>\s*<Color[^>]*V="(#[0-9a-fA-F]{6,8})"/)?.[1]
        )
        paths.push({ id, d, stroke, strokeWidth, fill: fill ?? 'none', type })
      }
      // Callout（标注框）自带文字，坐标【相对自身框左上角】——实测 id=210 的
      // 框宽 221.68、文字 CX 110.64 正好是居中值，说明它相对的是框而不是画布。
      // 0.7.0 之前把 Callout 和 Boundary 归成一类、只画框不读文字，
      // 于是「标注框里的文字看不见，只能看见框」。
      const own = readLabel(body, left, top, false, id)
      if (own) labels.push(own)
      continue
    }

    // 普通节点
    if (width === undefined || height === undefined) continue
    const lines: string[] = []
    let fontSize = 12
    let color = '#333333'
    const textBlock = body.match(/<TextBlock[^>]*>([\s\S]*?)<\/TextBlock>/)
    if (textBlock) {
      const tb = textBlock[1]!
      const character = tb.match(/<Character[^>]*>/)
      if (character) {
        const size = character[0].match(/Size="([\d.]+)"/)
        const textColor = character[0].match(/Color="(#[0-9a-fA-F]{6,8})"/)
        if (size) fontSize = Number(size[1])
        const normalized = normalizeColor(textColor?.[1])
        if (normalized) color = normalized
      }
      // 按 <pp> 分段：<tp> 只是段内片段，见 readTextLines 的说明
      lines.push(...readTextLines(tb))
    }

    const left = cx - width / 2
    const top = cy - height / 2
    const fill =
      normalizeColor(body.match(/<FillFormat[^>]*>\s*<Color[^>]*V="(#[0-9a-fA-F]{6,8})"/)?.[1]) ??
      '#ffffff'
    shapes.push({
      id,
      type,
      x: left,
      y: top,
      width,
      height,
      lines,
      fontSize,
      color,
      fill,
      stroke,
      textBox: readTextBox(body, left, top)
    })
  }

  // 起点若与连线锚点之间差一小段【水平或垂直】的距离，补一条直线接上。
  //
  // 放在这里而不是解析循环里：连线在 XML 里可能排在它连接的节点之前，
  // 需要先确认锚点附近确实有节点框（避免给指向分组框的线乱补）。
  //
  // 注意：绝不搬动原始几何的任何点。EdrawMind 算好的形状（母线、小圆角、
  // 短横支线）本身就是最终效果，实测终点 100% 精确落在框上、起点只差一段
  // 轴对齐的距离；上一版「把端点钉到框边中点」反而把直线拉成了斜线与鼓包。
  const nodeBoxes = shapes.map((shape) => ({
    x: shape.x,
    y: shape.y,
    width: shape.width,
    height: shape.height
  }))
  for (const path of paths) {
    if (path.type !== 'MMConnector' && path.type !== 'RelatConnector') continue
    path.d = bridgeStartGap(path.d, path.anchors, nodeBoxes)
  }

  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  const extend = (x: number, y: number): void => {
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }
  for (const shape of shapes) {
    extend(shape.x, shape.y)
    extend(shape.x + shape.width, shape.y + shape.height)
  }
  for (const path of paths) {
    for (const point of pathPoints(path.d)) extend(point.x, point.y)
  }
  // 标签也要算进包围盒，否则靠边的标签会被裁掉
  for (const label of labels) {
    extend(label.x, label.y)
    extend(label.x + label.width, label.y + label.height)
  }
  if (!Number.isFinite(minX)) {
    minX = 0
    minY = 0
    maxX = 0
    maxY = 0
  }

  return {
    name: entryName,
    title: titleMatch?.[1]?.trim() || entryName,
    width: numberTag(xml, 'Width') ?? maxX - minX,
    height: numberTag(xml, 'Height') ?? maxY - minY,
    shapes,
    paths,
    labels,
    bounds: { minX, minY, maxX, maxY }
  }
}

/**
 * 从画布的 XML 里抽出层级大纲。
 *
 * 节点的父子关系存在 LevelData 里：父节点用 <SubLevel V="子id;子id">，
 * 子节点用 <Super V="父id">。据此深度优先遍历，就能得到带缩进的大纲——
 * 不需要用户另外从 EdrawMind 导出 markdown。
 */
function buildOutline(xml: string): EmmxOutlineLine[] {
  interface Node {
    id: string
    text: string
    parent?: string
    children: string[]
  }
  const nodes = new Map<string, Node>()
  const shapePattern = /<Shape\s+ID="(\d+)"\s+Type="([^"]+)"[^>]*>([\s\S]*?)<\/Shape>/g
  let match: RegExpExecArray | null
  while ((match = shapePattern.exec(xml))) {
    const id = match[1]!
    const body = match[3]!
    const textBlock = body.match(/<TextBlock[^>]*>([\s\S]*?)<\/TextBlock>/)
    // 与图形渲染用同一套分段口径，保证大纲与画布上的行数一致
    const lines = textBlock ? readTextLines(textBlock[1]!) : []
    const superMatch = body.match(/<Super V="(\d+)"/)
    const subMatch = body.match(/<SubLevel V="([^"]*)"/)
    nodes.set(id, {
      id,
      text: lines.join(' '),
      parent: superMatch?.[1],
      children: subMatch
        ? subMatch[1]!
            .split(';')
            .map((value) => value.trim())
            .filter(Boolean)
        : []
    })
  }

  const outline: EmmxOutlineLine[] = []
  const visited = new Set<string>()
  const walk = (id: string, depth: number): void => {
    // 深度上限防御环形引用；导图实际层级远达不到
    if (visited.has(id) || depth > 20) return
    visited.add(id)
    const node = nodes.get(id)
    if (!node) return
    if (node.text) outline.push({ text: node.text, depth })
    for (const child of node.children) walk(child, depth + 1)
  }

  // 没有父节点的就是根
  for (const node of nodes.values()) {
    if (!node.parent) walk(node.id, 0)
  }
  // 兜底：没被层级串起来的孤立节点也要收进来，不能丢内容
  for (const node of nodes.values()) {
    if (!visited.has(node.id) && node.text) outline.push({ text: node.text, depth: 0 })
  }
  return outline
}

/**
 * 解析 .emmx 文件内容。
 *
 * 注意两种存储格式：
 * - EdrawMind 8.x 保存为 page/page.xml（文本），可以完整还原图形
 * - EdrawMind 12.x 保存为 mmpage/page.bin（私有二进制），无法还原图形，
 *   只能读 document.xml 里的元信息
 * 遇到 12.x 的文件时抛出的错误会说明该怎么办（导出 HTML），而不是只说「读不到」。
 */
export function parseEmmx(buffer: Buffer): EmmxDocument {
  if (!buffer.length) throw new AppError('EMMX_EMPTY', 'PARSE', '导图文件为空。')
  if (buffer.readUInt32LE(0) !== ZIP_LOCAL_HEADER) {
    throw new AppError('EMMX_NOT_ZIP', 'PARSE', '这不是有效的 EdrawMind 导图文件。')
  }
  const entries = readZipEntries(buffer)

  // 新版（12.x）把画布存成 mmpage/*.bin 私有二进制，没有公开规范，
  // 实测无法可靠还原图形。这种情况给出可操作的提示，而不是笼统的「读不到画布」。
  const binaryPages = entries.filter((entry) => /^mmpage\/.*\.bin$/.test(entry.name))
  const pageEntries = entries
    .filter((entry) => /^page\/page.*\.xml$/.test(entry.name))
    // page.xml 在前，page-1.xml、page-2.xml 依序在后，保证画布顺序稳定
    .sort((a, b) => {
      const order = (name: string): number => {
        const m = name.match(/page(?:-(\d+))?\.xml$/)
        return m?.[1] ? Number(m[1]) : 0
      }
      return order(a.name) - order(b.name)
    })

  if (!pageEntries.length && binaryPages.length) {
    const version = readDocumentVersion(buffer, entries)
    throw new AppError(
      'EMMX_NEW_FORMAT',
      'PARSE',
      `这是 EdrawMind ${version ? `${version} ` : ''}保存的导图，画布数据是它自己的私有格式，` +
        `软件无法还原图形。请在 EdrawMind 里用「导出」生成 HTML 文件，再把那个 HTML 添加进来，` +
        `就能看到完整图形并切换子页面。`,
      false
    )
  }
  if (!pageEntries.length) {
    throw new AppError('EMMX_NO_PAGE', 'PARSE', '导图里没有可读取的画布。')
  }

  const pages: EmmxPage[] = []
  const outline: EmmxOutlineLine[] = []
  for (const entry of pageEntries) {
    const xml = readEntry(buffer, entry).toString('utf8')
    pages.push(parsePage(entry.name, xml))
    // 多个画布时，后面的画布大纲接在后面并整体降一级，读起来像章节
    const pageOutline = buildOutline(xml)
    if (pageEntries.length > 1) {
      const page = pages[pages.length - 1]!
      outline.push({ text: page.title, depth: 0 })
      for (const line of pageOutline) outline.push({ text: line.text, depth: line.depth + 1 })
    } else {
      outline.push(...pageOutline)
    }
  }

  let modifiedAt: string | undefined
  const documentEntry = entries.find((entry) => entry.name === 'document.xml')
  if (documentEntry) {
    const xml = readEntry(buffer, documentEntry).toString('utf8')
    const match = xml.match(/<ModifiedDate\s+V="([^"]+)"/)
    if (match) modifiedAt = match[1]
  }

  return { pages, outline, modifiedAt }
}

/**
 * 解码 .emmx 文字里的 XML 实体。
 *
 * EdrawMind 会把引号等字符存成实体（实测「3.&quot;这个故事，&quot;快乐尸体说」）。
 * 0.7.0 直接把这些实体当普通文字，既在画面上显示出 `&quot;` 这样的字样，
 * 又让宽度估算虚高（10 个字符的实体被当成 10 个字来量宽），于是本该放下的
 * 长句被误判为超宽。必须先还原成真实字符，再做量宽与转义。
 */
function decodeXmlEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    // &amp; 必须最后处理，否则 "&amp;quot;" 会被解成引号
    .replace(/&amp;/g, '&')
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * 行距倍数。
 *
 * 0.7.0 用 1.25，实测会溢出：「感受到一种病态的美学崇拜」5 段文字，
 * 5 × 1.25 × 10 = 62.5px，而文字框高只有 55.3px，多出的 7.2px 压到下方节点上。
 *
 * 反推 EdrawMind 的真实行距：同一个节点的文字框高 55.3px 正好容纳 5 行，
 * 55.3 / 5 / 10 ≈ 1.1。三个真实文件按 1.1 计算均无溢出（1.15 起开始溢出），
 * 故取 1.1。
 */
const LINE_HEIGHT_RATIO = 1.1

/** 估算一段文字在给定字号下的像素宽度。
 *
 * SVG 的 <text> 不会自动折行，而 EdrawMind 的 XML 只存原始段落
 * （一个 <tp> 就是一整段话），所以必须自己按框宽切分，否则长句会溢出、
 * 压到相邻节点上——这正是 0.7.0 之前「文字框一直重叠」的直接原因。
 *
 * 按字符类别估宽：CJK 与全角符号约等于字号，其余约 0.55 倍。
 * 不需要绝对精确，只要能把长句切到框内即可。
 */
function measureText(text: string, fontSize: number): number {
  let width = 0
  for (const char of text) {
    width += /[\u3000-\u9fff\uff00-\uffef]/.test(char) ? fontSize : fontSize * 0.55
  }
  return width
}

/**
 * 把一段文字按可用宽度切成多行。
 *
 * 中英混排时优先在空格处断行；没有空格就逐字断。已有的换行符照原样保留。
 */
function wrapText(text: string, fontSize: number, maxWidth: number): string[] {
  if (maxWidth <= 0) return [text]
  // 直接按可用宽度折行。0.7.1 曾在这里留 4% 余量，结果把 EdrawMind 本来
  // 正好放得下的段落拆成两行（实测「感受到一种病态的美学崇拜」第 1 段
  // 估宽 480.0、可用宽正好 480.0，卡在边界被拆开），5 段变 6 行反而溢出框高。
  // 量宽是估算值，留余量只会引入新的溢出，不如按真实可用宽度切。
  if (measureText(text, fontSize) <= maxWidth) return [text]

  const lines: string[] = []
  let current = ''
  let currentWidth = 0

  const pushCurrent = (): void => {
    if (current) lines.push(current)
    current = ''
    currentWidth = 0
  }

  for (const char of text) {
    if (char === '\n') {
      pushCurrent()
      continue
    }
    const charWidth = measureText(char, fontSize)
    if (currentWidth + charWidth > maxWidth && current) {
      // 英文单词尽量不拆开：回退到最后一个空格处断行
      const lastSpace = current.lastIndexOf(' ')
      if (lastSpace > 0 && /[A-Za-z0-9]/.test(char)) {
        lines.push(current.slice(0, lastSpace))
        current = current.slice(lastSpace + 1)
        currentWidth = measureText(current, fontSize)
      } else {
        pushCurrent()
      }
    }
    current += char
    currentWidth += charWidth
  }
  pushCurrent()
  return lines.length ? lines : ['']
}

/**
 * 把一个文字块渲染成 SVG <text> 行。
 *
 * 负责折行、按文字框定位、以及多行的纵向居中。
 * areaX/areaY/areaWidth/areaHeight 是文字可用区域（绝对坐标）。
 */
function renderTextLines(
  parts: string[],
  lines: string[],
  options: {
    x: number
    y: number
    width: number
    height: number
    fontSize: number
    color: string
    /** 是否按区域宽度折行；连线标签这类小标注不折 */
    wrap?: boolean
    /**
     * 这段文字所属的图形 id。
     *
     * 写进 <text data-shape="..."> 有两个用处：一是界面上做节点搜索时能精确定位
     * 到某个节点（并给它描边高亮）；二是测试可以据此把每一行归到正确的节点，
     * 不必靠 x/y 区间去猜——实测相邻节点的文字框中心 x 相同、y 区间重叠，
     * 靠坐标无法区分。
     */
    shapeId?: string
    /**
     * 节点框的垂直范围（硬边界）。
     *
     * 文字框有时装不下全部文字（实测「阅读相关档案会梦到」2 段需要 22px，
     * 而文字框只有 18.4px——EdrawMind 按单行给了框高）。此时若仍以文字框
     * 为准，文字就会压到下方节点上。节点框是真正的边界（实测同例节点框高
     * 24.7px，装得下），所以放不下时改在节点框内垂直居中。
     */
    nodeTop?: number
    nodeHeight?: number
  }
): void {
  const { x, y, width, height, fontSize, color } = options
  const wrapped: string[] = []
  for (const line of lines) {
    if (options.wrap === false) wrapped.push(line)
    else wrapped.push(...wrapText(line, fontSize, width))
  }
  if (!wrapped.length) return
  const lineHeight = fontSize * LINE_HEIGHT_RATIO
  const blockHeight = wrapped.length * lineHeight
  // 垂直定位：优先在文字框内居中；文字框装不下时退到节点框内居中；
  // 连节点框都装不下才从文字框顶部开始排（宁可轻微溢出也不裁掉第一行）
  let areaTop = y
  let areaHeight = height
  if (
    blockHeight > height &&
    options.nodeTop !== undefined &&
    options.nodeHeight !== undefined &&
    blockHeight <= options.nodeHeight
  ) {
    areaTop = options.nodeTop
    areaHeight = options.nodeHeight
  }
  const startY =
    blockHeight > areaHeight
      ? areaTop + fontSize * 0.95
      : areaTop + areaHeight / 2 - blockHeight / 2 + fontSize * 0.95
  const shapeAttr = options.shapeId ? ` data-shape="${escapeXml(options.shapeId)}"` : ''
  let baseline = startY
  for (const line of wrapped) {
    parts.push(
      `<text x="${x + width / 2}" y="${baseline}" font-family="Microsoft YaHei, sans-serif" ` +
        `font-size="${fontSize}" fill="${color}" text-anchor="middle"${shapeAttr}>${escapeXml(line)}</text>`
    )
    baseline += lineHeight
  }
}

/**
 * 在连线起点与它的锚点之间补一小段直线，把缺口接上。
 *
 * 背景（用户反馈「线条原本直线就能解决，现在变得曲里拐弯」）：
 * EdrawMind 的几何本身就是最终效果——父节点出发一小段圆角、沿竖直干线延伸、
 * 分支点用小圆角转向子节点、子节点之间是短横直线。用三个真实 .emmx 量化后：
 *   - 终点与几何末点【完全相同】：102/102、155/155、804/804（100%）
 *   - 起点要么与几何首点相同，要么只差一段【轴对齐】的距离（60/60、90/90、435/435）
 *   - 不轴对齐的端点：0 个
 * 也就是说原始几何本来就完整正确，任何「搬动端点」的做法都会破坏形状
 * （上一版把端点钉到框边中点，结果把直线拉成了斜线与鼓包）。
 *
 * 所以这里只做一件事：若起点/终点与对应锚点之间差一段水平或垂直的距离，
 * 在路径相应一端插一条直线段接上。其余坐标一律原样保留。
 */
function bridgeStartGap(
  d: string,
  anchors: { beginX: number; beginY: number; endX: number; endY: number } | undefined,
  boxes: Array<{ x: number; y: number; width: number; height: number }>
): string {
  if (!anchors) return d
  const tokens = d.split(/(?=[MLC])/).filter(Boolean)
  if (!tokens.length) return d

  /** 读出某个 token 的落点（该段最后一个坐标对） */
  const endPointOf = (token: string): { x: number; y: number } | undefined => {
    const nums = token
      .slice(1)
      .trim()
      .split(/[\s,]+/)
      .map(Number)
      .filter((value) => Number.isFinite(value))
    // 只处理单点段（M/L）与曲线落点（C 的 x2 y2）；其余不动
    if (nums.length !== 2 && nums.length !== 6) return undefined
    return { x: nums[nums.length - 2]!, y: nums[nums.length - 1]! }
  }

  /**
   * 判断某个锚点是否值得补一段接线。
   *
   * 实测所有需要补的缺口都是纯水平或纯垂直的（0 个例外）。若两个方向都差得多，
   * 说明它不是「接线缺口」而是别的东西（例如指向分组框），硬补会凭空多出斜线。
   */
  const shouldBridge = (from: { x: number; y: number }, to: { x: number; y: number }): boolean => {
    const dx = to.x - from.x
    const dy = to.y - from.y
    if (Math.hypot(dx, dy) < 0.6) return false
    if (!(Math.abs(dx) < 0.6 || Math.abs(dy) < 0.6)) return false
    // 锚点附近要有节点框，否则这条线指向的不是节点（例如分组框外沿）
    return boxes.some(
      (box) =>
        to.x >= box.x - 2 &&
        to.x <= box.x + box.width + 2 &&
        to.y >= box.y - 2 &&
        to.y <= box.y + box.height + 2
    )
  }

  let out = tokens

  // 起点：把锚点插到最前面，原起点变成第二点，形状不变，只多一小段接线
  const startPoint = endPointOf(tokens[0]!)
  if (startPoint && shouldBridge(startPoint, { x: anchors.beginX, y: anchors.beginY })) {
    out = [`M${anchors.beginX} ${anchors.beginY}`, `L${startPoint.x} ${startPoint.y}`, ...out.slice(1)]
  }

  // 终点：在末尾追加一小段到锚点（同一条直线延长，方向不变）
  const lastToken = out[out.length - 1]!
  const lastPoint = endPointOf(lastToken)
  if (lastPoint && shouldBridge(lastPoint, { x: anchors.endX, y: anchors.endY })) {
    out = [...out, `L${anchors.endX} ${anchors.endY}`]
  }

  return out.join(' ')
}


/** 读自闭合元素上的属性数值，如 <BeginPt X="1" Y="2"/> */
function numberAttr(xml: string, tag: string, attribute: string): number | undefined {
  const matched = xml.match(new RegExp(`<${tag}\\b[^>]*?\\b${attribute}="(-?[\\d.]+)"`))
  return matched ? Number(matched[1]) : undefined
}

/**
 * 把一个画布渲染成矢量 SVG。
 *
 * 线条用 EdrawMind 的真实几何（曲线、折线、分组框、概括括号），
 * 节点形状统一为圆角矩形。这样即使导图做到 5000px 宽，放大后依然锐利。
 */
export function pageToSvg(page: EmmxPage, padding = 40): string {
  const { minX, minY, maxX, maxY } = page.bounds
  const width = maxX - minX + padding * 2
  const height = maxY - minY + padding * 2
  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${minX - padding} ${minY - padding} ${width} ${height}" width="${Math.round(width)}" height="${Math.round(height)}">`,
    `<rect x="${minX - padding}" y="${minY - padding}" width="${width}" height="${height}" fill="#ffffff"/>`
  ]

  // 分组框先画（在最底层），且只有带填充的才铺底色，否则会盖住里面的节点
  for (const path of page.paths) {
    if (path.type === 'MMConnector' || path.type === 'RelatConnector') continue
    parts.push(
      `<path d="${path.d}" fill="${path.fill}" stroke="${path.stroke}" stroke-width="${path.strokeWidth}" stroke-linejoin="round"/>`
    )
  }
  // 连接线：原样使用 EdrawMind 的几何（母线、小圆角、短横支线都是它算好的），
  // 只在起点缺口处补过一小段直线（见 bridgeStartGap）
  for (const path of page.paths) {
    if (path.type !== 'MMConnector' && path.type !== 'RelatConnector') continue
    parts.push(
      `<path d="${path.d}" fill="none" stroke="${path.stroke}" stroke-width="${path.strokeWidth}" stroke-linecap="round" stroke-linejoin="round"/>`
    )
  }
  // 节点压在最上面
  for (const shape of page.shapes) {
    const radius = Math.min(8, shape.height / 4)
    // data-shape 供界面做节点搜索定位与高亮
    parts.push(
      `<rect data-shape="${escapeXml(shape.id)}" x="${shape.x}" y="${shape.y}" width="${shape.width}" height="${shape.height}" ` +
        `rx="${radius}" ry="${radius}" fill="${shape.fill}" stroke="${shape.stroke}" stroke-width="1.2"/>`
    )
    if (!shape.lines.length) continue
    // 用节点自己的文字区域（相对节点框左上角）定位并按框宽折行；
    // 取不到文字框时退回整个节点框
    const area = shape.textBox ?? {
      x: shape.x,
      y: shape.y,
      width: shape.width,
      height: shape.height
    }
    renderTextLines(parts, shape.lines, {
      x: area.x,
      y: area.y,
      width: area.width,
      height: area.height,
      fontSize: shape.fontSize,
      color: shape.color,
      shapeId: shape.id,
      nodeTop: shape.y,
      nodeHeight: shape.height
    })
  }

  // 关系连线的说明与分组框标题：浮在最上层，不画底色。
  // 这些是短标注，按原样单行绘制，不折行。
  for (const label of page.labels) {
    renderTextLines(parts, label.lines, {
      x: label.x,
      y: label.y,
      width: label.width,
      height: label.height,
      fontSize: label.fontSize,
      color: label.color,
      wrap: false,
      ...(label.id ? { shapeId: label.id } : {})
    })
  }
  parts.push('</svg>')
  return parts.join('\n')
}

/** 取出导图的全部大纲文字（不含层级），供搜索使用 */
export function emmxOutline(document: EmmxDocument): string[] {
  return document.outline.map((line) => line.text)
}

/** 把大纲导出成 markdown 列表；要拿去别的软件用时才需要 */
export function outlineToMarkdown(document: EmmxDocument, title: string): string {
  const lines = [`# ${title}`, '']
  for (const line of document.outline) {
    lines.push(`${'  '.repeat(line.depth)}- ${line.text}`)
  }
  return `${lines.join('\n')}\n`
}
