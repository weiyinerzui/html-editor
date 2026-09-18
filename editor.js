/* ============================================================
 * Visual HTML Editor — core engine (original implementation)
 * A dependency-free WYSIWYG page editor that runs entirely in
 * the browser: select / drag / inline-edit / insert / undo /
 * save / PDF export.
 *
 * Everything the editor renders lives inside one UI root marked
 * with [data-hve-ui]; runtime marks on content use the data-hve-*
 * prefix and are stripped when the page is saved.
 * ============================================================ */
(function () {
  'use strict';

  /* ---------------------------------------------------------
   * 0. Constants
   * ------------------------------------------------------- */

  const PERSISTENT_MARKS = new Set(['data-hve-group', 'data-hve-locked', 'data-hve-floating']);
  const UNDO_LIMIT = 100;
  const DRAG_THRESHOLD = 5;
  const SNAP_PX = 6;

  const FONT_OPTIONS = [
    { label: 'Default', value: '' },
    { label: 'Arial', value: 'Arial, Helvetica, sans-serif' },
    { label: 'Helvetica Neue', value: '"Helvetica Neue", Helvetica, Arial, sans-serif' },
    { label: 'Georgia', value: 'Georgia, "Times New Roman", serif' },
    { label: 'Times New Roman', value: '"Times New Roman", Times, serif' },
    { label: 'Courier New', value: '"Courier New", Courier, monospace' },
    { label: 'Verdana', value: 'Verdana, Geneva, sans-serif' },
    { label: 'Tahoma', value: 'Tahoma, Verdana, sans-serif' },
    { label: 'Trebuchet MS', value: '"Trebuchet MS", Tahoma, sans-serif' },
    { label: 'Palatino', value: '"Palatino Linotype", Palatino, serif' },
    { label: 'Garamond', value: 'Garamond, "Palatino Linotype", serif' },
    { label: 'Impact', value: 'Impact, Charcoal, sans-serif' },
    { label: 'Comic Sans MS', value: '"Comic Sans MS", "Comic Sans", cursive' }
  ];

  const SIZE_OPTIONS = [10, 11, 12, 13, 14, 16, 18, 20, 24, 28, 32, 36, 40, 48];

  const HEADING_OPTIONS = [
    { label: 'Paragraph', value: 'P' },
    { label: 'Heading 1', value: 'H1' },
    { label: 'Heading 2', value: 'H2' },
    { label: 'Heading 3', value: 'H3' },
    { label: 'Heading 4', value: 'H4' },
    { label: 'Heading 5', value: 'H5' },
    { label: 'Heading 6', value: 'H6' }
  ];

  const RADIUS_OPTIONS = [
    { label: 'None', value: '0px' },
    { label: 'Small · 4px', value: '4px' },
    { label: 'Medium · 8px', value: '8px' },
    { label: 'Large · 12px', value: '12px' },
    { label: 'X-Large · 16px', value: '16px' },
    { label: 'XX-Large · 24px', value: '24px' },
    { label: 'Pill · 999px', value: '999px' },
    { label: 'Circle · 50%', value: '50%' }
  ];

  const SHADOW_OPTIONS = [
    { label: 'None', value: 'none' },
    { label: 'Subtle', value: '0 1px 3px rgba(20,20,19,0.15)' },
    { label: 'Medium', value: '0 4px 12px rgba(20,20,19,0.18)' },
    { label: 'Large', value: '0 8px 24px rgba(20,20,19,0.22)' },
    { label: 'X-Large', value: '0 16px 48px rgba(20,20,19,0.28)' }
  ];

  const COLOR_SWATCHES = [
    '#000000', '#3d3d3a', '#6c6a64', '#8e8b82', '#b3ada2', '#d8cec2', '#efe9de', '#ffffff',
    '#fff8f0', '#cc785c', '#a9583e', '#8c4a34', '#f4c7b8', '#f9e3da', '#e14b8f', '#f78fb3',
    '#e91e63', '#ad1457', '#ef4444', '#b91c1c', '#fca5a5', '#fee2e2', '#f59e0b', '#fbbf24',
    '#fde68a', '#fff9c4', '#10b981', '#059669', '#34d399', '#a7f3d0', '#3aa08b', '#ccfbf1',
    '#3b82f6', '#1d4ed8', '#93c5fd', '#dbeafe', '#6366f1', '#4338ca', '#c7d2fe', '#e0e7ff'
  ];

  const BRUSH_PROPS = [
    'fontFamily', 'fontSize', 'fontWeight', 'color', 'backgroundColor',
    'textAlign', 'lineHeight', 'borderRadius', 'boxShadow', 'padding', 'margin'
  ];

  /* ---------------------------------------------------------
   * 1. State
   * ------------------------------------------------------- */

  const state = {
    editMode: false,
    selected: [],           // elements currently selected
    primary: null,          // last clicked element
    editingEl: null,        // element in inline text-edit mode
    hovered: null,
    undoStack: [],
    redoStack: [],
    clipboardHTML: null,
    styleClipboard: null,
    brush: null,            // { styles, continuous }
    fileName: '',
    insertMode: 'flow',     // 'flow' | 'float'
    quickAddRef: null,
    dragging: null,
    resizing: null,
    panels: { pages: false, chart: false, pdf: false },
    lang: (function () {
      try { return localStorage.getItem('hve-lang') || 'zh'; } catch (err) { return 'zh'; }
    })()
  };

  let uiRoot, controlBar, toolbar, toastWrap, statusBtn, resizeBox,
      multiToast, dragGhost, insertIndicator, marqueeEl, quickAddBtn, dropOverlay;

  /* ---------------------------------------------------------
   * 6.5 Internationalisation — UI strings + document strings.
   * English is the source/key language; ZH is the default.
   * ------------------------------------------------------- */

  const I18N_ZH = {
    // control bar & status
    'Visual HTML Editor': '可视化 HTML 编辑器',
    'free · in-browser · no sign-up': '免费 · 浏览器内使用 · 无需注册',
    'Edit': '编辑', 'Editing': '编辑中', 'Open': '打开', 'Save As': '保存',
    'Toggle edit mode': '切换编辑模式',
    'Open a local HTML file (Ctrl+O)': '打开本地 HTML 文件 (Ctrl+O)',
    'Download clean HTML (Ctrl+S)': '下载干净的 HTML 文件 (Ctrl+S)',
    'Export as PDF': '导出 PDF',
    'View mode': '视图模式',
    'Editing · click to pause': '编辑中 · 点击暂停',
    // toolbar
    'Bold (Ctrl+B)': '加粗 (Ctrl+B)', 'Italic (Ctrl+I)': '斜体 (Ctrl+I)',
    'Underline (Ctrl+U)': '下划线 (Ctrl+U)', 'Strikethrough': '删除线',
    'Font family': '字体', 'Font size': '字号',
    'Paragraph / heading level': '段落 / 标题级别',
    'Align left': '左对齐', 'Align center': '居中对齐', 'Align right': '右对齐',
    'Text color': '文字颜色', 'Background color': '背景颜色',
    'Border radius': '圆角', 'Box shadow': '阴影', 'Opacity': '透明度',
    'Insert element': '插入元素',
    'Format brush — double-click for continuous mode': '格式刷 — 双击进入连续模式',
    'Duplicate (Ctrl+D)': '复制元素 (Ctrl+D)',
    'Move earlier in container': '在容器中前移', 'Move later in container': '在容器中后移',
    'Lock / unlock (Ctrl+L)': '锁定 / 解锁 (Ctrl+L)',
    'Delete (Del)': '删除 (Del)',
    'Page sorter (Ctrl+Shift+P)': '页面管理器 (Ctrl+Shift+P)',
    'Chart typography panel': '图表排版面板',
    'Undo (Ctrl+Z)': '撤销 (Ctrl+Z)', 'Redo (Ctrl+Y)': '重做 (Ctrl+Y)',
    // selects & option lists
    'Default': '默认', 'Paragraph': '正文',
    'Heading 1': '一级标题', 'Heading 2': '二级标题', 'Heading 3': '三级标题',
    'Heading 4': '四级标题', 'Heading 5': '五级标题', 'Heading 6': '六级标题',
    'None': '无', 'Subtle': '轻微', 'Medium': '中等', 'Large': '较大', 'X-Large': '特大',
    'Small · 4px': '小 · 4px', 'Medium · 8px': '中 · 8px', 'Large · 12px': '大 · 12px',
    'X-Large · 16px': '特大 · 16px', 'XX-Large · 24px': '超大 · 24px',
    'Pill · 999px': '胶囊 · 999px', 'Circle · 50%': '圆形 · 50%',
    // misc UI
    'Insert an element here': '在此插入元素',
    'Drop images to insert': '拖放图片到此处插入',
    '{n} elements': '{n} 个元素',
    'elements selected': '个元素已选中',
    'Group': '编组', 'Duplicate': '复制', 'Delete': '删除',
    'Shift+click to toggle · Ctrl+click to add': 'Shift+点击 取消 · Ctrl+点击 追加',
    // toasts
    'Undo': '已撤销', 'Redo': '已重做', 'Duplicated': '已复制元素',
    'Element deleted': '已删除元素', '{n} elements deleted': '已删除 {n} 个元素',
    'Locked 🔒 — click again + Ctrl+L to unlock': '已锁定 🔒 — 再按 Ctrl+L 解锁',
    'Unlocked': '已解锁', 'Layer updated': '层级已更新',
    'Style copied': '已复制样式', 'No style copied yet': '还没有已复制的样式',
    'Style applied': '已应用样式', 'Inline styles cleared': '已清除内联样式',
    'Copied {n} element(s)': '已复制 {n} 个元素',
    'Clipboard is empty': '剪贴板为空', 'Pasted': '已粘贴',
    'Select a styled element first': '请先选择一个带样式的元素',
    'Continuous format brush — Esc to exit': '连续格式刷 — 按 Esc 退出',
    'Format brush armed — click a target': '格式刷已就绪 — 点击目标元素',
    'Invalid hex color': '无效的颜色值',
    'Inserted — drag to reposition': '已插入 — 拖动可调整位置',
    'Select multiple elements first (Ctrl+click)': '请先多选元素 (Ctrl+点击)',
    'Cannot delete the last row': '不能删除最后一行',
    'Cannot delete the last column': '不能删除最后一列',
    'Stripes removed': '已移除斑马纹', 'Striped style applied': '已应用斑马纹',
    'Select at least 2 elements to group (Ctrl+click)': '请至少选择 2 个元素再编组 (Ctrl+点击)',
    'Grouped elements must share the same parent': '编组的元素必须在同一个父容器中',
    'Grouped — drag to move together': '已编组 — 可整体拖动',
    'Select a group first (teal dashed outline)': '请先选中一个编组（青色虚线框）',
    'Ungrouped': '已解组', 'Select an element first': '请先选中一个元素',
    'Generating…': '生成中…', 'Generating PDF…': '正在生成 PDF…',
    'PDF libraries need network — using print instead': 'PDF 组件需联网 — 已改用打印导出',
    'PDF exported ✓': 'PDF 已导出 ✓', 'PDF export failed: {msg}': 'PDF 导出失败：{msg}',
    'Saved {name}': '已保存 {name}',
    'Could not read file: {msg}': '无法读取文件：{msg}',
    'Invalid HTML file': '无效的 HTML 文件',
    'Opened {name} — click Edit to start': '已打开 {name} — 点击「编辑」开始',
    'Only image files can be dropped': '只能拖放图片文件',
    // dialogs
    'Cancel': '取消', 'OK': '确定', 'Insert': '插入',
    'Insert Table': '插入表格', 'Rows': '行数', 'Columns': '列数',
    'Include header row': '包含表头行',
    'Insert Image': '插入图片', 'Image URL': '图片 URL',
    'https://… or leave empty if uploading a file': 'https://… 或留空后选择本地文件',
    'Alt text (optional)': '替代文本（可选）', 'Describe the image': '描述这张图片',
    'Provide an image URL or choose a file': '请填写图片 URL 或选择文件',
    'Insert Link': '插入链接', 'Link text': '链接文字', 'Read more': '阅读更多',
    'link': '链接',
    // insert panel
    '▤ Flow': '▤ 文档流', '✦ Float': '✦ 浮动',
    'Container': '容器', 'Wrapper box for other content': '用于容纳其他内容的容器',
    'Text Box': '文本框', 'A paragraph of text': '一段文本',
    'Heading': '标题', 'Heading text (H2)': '标题文字 (H2)',
    'Table': '表格', 'Rows & columns of data': '行与列的数据',
    'Image': '图片', 'From file or URL': '来自文件或 URL',
    'Button': '按钮', 'Clickable button element': '可点击的按钮',
    'Divider': '分隔线', 'Horizontal rule': '水平分隔线',
    'Link': '链接', 'Hyperlink text': '超链接文字',
    'List': '列表', 'Bulleted list': '无序列表',
    'Quote': '引用', 'Blockquote': '引用块',
    // element factories
    'Container — drop or insert elements here': '容器 — 在此放置或插入元素',
    'Double-click to edit this text. Use the floating toolbar to change fonts, colors and alignment.': '双击编辑这段文字。可使用悬浮工具栏修改字体、颜色和对齐方式。',
    'Your Heading Here': '在此输入标题', 'Click Me': '点我',
    'First list item': '第一个列表项', 'Second list item': '第二个列表项', 'Third list item': '第三个列表项',
    'Double-click to edit this quote.': '双击编辑这段引用。',
    'Header': '表头', 'Cell': '单元格', 'Header {n}': '表头 {n}',
    'Pasted image': '粘贴的图片', 'Text': '文字',
    // context menu
    'Unlock Element': '解锁元素', 'Select Parent': '选择父级',
    'Edit Text': '编辑文字', 'Duplicate Element': '复制元素',
    'Copy Style': '复制样式', 'Paste Style': '粘贴样式', 'Clear Style': '清除样式',
    'Bring Forward': '上移一层', 'Send Backward': '下移一层',
    'Bring to Front': '移到最前', 'Send to Back': '移到最后',
    'Ungroup': '解组', 'Lock Element': '锁定元素',
    'Insert Row Above': '在上方插入行', 'Insert Row Below': '在下方插入行',
    'Insert Column Left': '在左侧插入列', 'Insert Column Right': '在右侧插入列',
    'Delete Current Row': '删除当前行', 'Delete Current Column': '删除当前列',
    'Toggle Table Style': '切换表格样式', 'Select Entire Table': '选中整个表格',
    // page sorter panel
    'Page Sorter': '页面管理器', '{n} blocks': '{n} 个区块',
    'Move up': '上移', 'Move down': '下移',
    'No page blocks found.': '未找到页面区块。', 'Close': '关闭',
    // chart typography panel
    'Chart Typography': '图表排版', 'Templates': '模板',
    'Fine-tune selected': '微调选中元素',
    'Font weight': '字重', 'Letter spacing': '字间距', 'Line height': '行高',
    '300 Light': '300 细体', '400 Regular': '400 常规', '500 Medium': '500 中等',
    '600 Semibold': '600 半粗', '700 Bold': '700 粗体', '800 Extrabold': '800 特粗',
    'Insert {name}': '插入{name}',
    'Data Card': '数据卡片', 'Metric Row': '指标行', 'Comparison': '对比',
    'Table Heading': '表头排版', 'Legend': '图例', 'Annotation': '批注',
    'Badge': '徽章', 'KPI Grid': 'KPI 网格',
    // PDF panel
    'Export PDF': '导出 PDF', 'Page size': '纸张大小',
    'Custom size (mm)': '自定义尺寸 (mm)', 'Custom…': '自定义…',
    'Orientation': '方向', '▯ Portrait': '▯ 纵向', '▭ Landscape': '▭ 横向',
    'Margins T / R / B / L (mm)': '页边距 上/右/下/左 (mm)',
    'Scale': '缩放', 'Preview page breaks': '预览分页线',
    '⬇ Export PDF': '⬇ 导出 PDF', '🖨 Print / Save as PDF': '🖨 打印 / 存为 PDF',
    'Page {n} starts here': '第 {n} 页从这里开始',
    'portrait': '纵向', 'landscape': '横向', '{n} page(s)': '{n} 页'
  };

  // Landing-page (demo document) strings. Keys live in data-i18n attributes.
    // Self-contained bilingual demo-document strings: key -> [English, Chinese].
  // Language switching only replaces content that still matches one of the two
  // pristine values, so user-edited text is never clobbered by a switch.
    // Self-contained bilingual demo-document strings: key -> [English, Chinese].
  // Language switching only replaces content that still matches one of the two
  // pristine values, so user-edited text is never clobbered by a switch.
  // English values are the browser-normalized runtime innerHTML — they must
  // match exactly what the DOM reports for the pristine page.
  const DOC_I18N = {
    "doc.title": ["Free Online HTML Editor — WYSIWYG Visual Web Page Editor", "免费在线 HTML 编辑器 — 可视化所见即所得网页编辑器"],
    "doc.desc": ["A free, open, in-browser WYSIWYG HTML editor. Click to select, drag to move, double-click to edit text, insert tables & images, export clean HTML or PDF. No sign-up, works offline.", "免费开源的浏览器内可视化 HTML 编辑器。点击选中、拖拽移动、双击编辑文字，插入表格与图片，导出干净的 HTML 或 PDF。无需注册，可离线使用。"],
    "hero.title": ["Free Online WYSIWYG HTML Editor", "免费在线可视化 HTML 编辑器"],
    "hero.sub": ["Edit any web page <strong>visually, right in your browser</strong> — click to select, drag to move, double-click to rewrite text. No code, no sign-up, no upload: everything runs locally.", "在浏览器里<strong>所见即所得</strong>地编辑任何网页 —— 点击选中、拖拽移动、双击改写文字。无需代码、无需注册、无需上传：一切都在本地完成。"],
    "cta.btn": ["✏️ Start editing this page", "✏️ 立即编辑这个页面"],
    "cta.hint": ["…or click <b>Edit</b> in the top bar", "…或点击顶栏的<b>编辑</b>按钮"],
    "quick.title": ["Get started in 5 steps", "五步上手"],
    "quick.s1": ["<strong>Select</strong> — click any element on this page to select it.", "<strong>选中</strong> —— 点击页面上的任意元素即可选中。"],
    "quick.s2": ["<strong>Move</strong> — drag it anywhere; magenta guides help you align.", "<strong>移动</strong> —— 拖到任何位置；洋红色参考线帮你对齐。"],
    "quick.s3": ["<strong>Edit</strong> — double-click text to type inline.", "<strong>编辑</strong> —— 双击文字即可原地修改。"],
    "quick.s4": ["<strong>Insert</strong> — use the <b>＋</b> toolbar button or right-click menu for tables, images, buttons…", "<strong>插入</strong> —— 用工具栏的 <b>＋</b> 按钮或右键菜单插入表格、图片、按钮……"],
    "quick.s5": ["<strong>Save</strong> — press <kbd style=\"background:#f5f0e8;padding:2px 6px;border-radius:4px;font-size:.9em;\">Ctrl+S</kbd> to download the clean HTML file.", "<strong>保存</strong> —— 按 <kbd style=\"background:#f5f0e8;padding:2px 6px;border-radius:4px;font-size:.9em;\">Ctrl+S</kbd> 下载干净的 HTML 文件。"],
    "feat.title": ["Everything you need", "功能一应俱全"],
    "feat.1h": ["🖱 Visual drag &amp; drop", "🖱 可视化拖拽"],
    "feat.1p": ["Reorder any element with smart alignment guides and distance labels. Arrow keys nudge by the pixel.", "智能对齐参考线与间距标签，随心重排任何元素；方向键可像素级微调。"],
    "feat.2h": ["✏️ Inline rich text", "✏️ 行内富文本"],
    "feat.2p": ["Double-click to write. Bold, italic, headings, 13 fonts, sizes, colors, alignment and effects from the floating toolbar.", "双击即可书写。悬浮工具栏提供加粗、斜体、标题、13 种字体、字号、颜色、对齐与效果。"],
    "feat.3h": ["▦ Tables &amp; images", "▦ 表格与图片"],
    "feat.3p": ["Insert tables with row/column operations, drop images from your desktop or paste them from the clipboard.", "插入表格并支持行/列操作；从桌面拖入图片，或直接从剪贴板粘贴。"],
    "feat.4h": ["⌨️ Full shortcuts", "⌨️ 完整快捷键"],
    "feat.4p": ["Undo/redo (100 steps), duplicate, copy/paste, group, lock, layers — all keyboard-driven.", "撤销/重做（100 步）、复制、样式复制粘贴、编组、锁定、图层 —— 全键盘操作。"],
    "feat.5h": ["📦 Multi-select &amp; groups", "📦 多选与编组"],
    "feat.5p": ["Ctrl+click or marquee-drag to select many elements, then group them and move everything as one.", "Ctrl+点击或框选多个元素，编组后作为整体移动。"],
    "feat.6h": ["📄 PDF export", "📄 PDF 导出"],
    "feat.6p": ["Paginate with a live page-break preview and export to PDF with configurable size, margins and scale.", "实时分页预览，可配置纸张、边距与缩放，一键导出 PDF。"],
    "use.title": ["What people build with it", "大家用它做什么"],
    "use.c1": ["<strong>Landing pages</strong><br><span style=\"font-size: .9em; color: #3d3d3a;\">Design and export in minutes.</span>", "<strong>落地页</strong><br><span style=\"font-size: .9em; color: #3d3d3a;\">几分钟内设计并导出。</span>"],
    "use.c2": ["<strong>Email templates</strong><br><span style=\"font-size: .9em; color: #3d3d3a;\">Table-based layouts made visual.</span>", "<strong>邮件模板</strong><br><span style=\"font-size: .9em; color: #3d3d3a;\">表格布局也能可视化编辑。</span>"],
    "use.c3": ["<strong>Mockups</strong><br><span style=\"font-size: .9em; color: #3d3d3a;\">Prototype without a design tool.</span>", "<strong>原型图</strong><br><span style=\"font-size: .9em; color: #3d3d3a;\">无需设计工具即可出原型。</span>"],
    "use.c4": ["<strong>PDF documents</strong><br><span style=\"font-size: .9em; color: #3d3d3a;\">Paginated reports and one-pagers.</span>", "<strong>PDF 文档</strong><br><span style=\"font-size: .9em; color: #3d3d3a;\">分页报告与一页纸方案。</span>"],
    "use.c5": ["<strong>Blog posts</strong><br><span style=\"font-size: .9em; color: #3d3d3a;\">Rich writing with tables &amp; media.</span>", "<strong>博客文章</strong><br><span style=\"font-size: .9em; color: #3d3d3a;\">图文表格的富文本写作。</span>"],
    "use.c6": ["<strong>Charts &amp; dashboards</strong><br><span style=\"font-size: .9em; color: #3d3d3a;\">KPI cards &amp; legends from templates.</span>", "<strong>图表看板</strong><br><span style=\"font-size: .9em; color: #3d3d3a;\">模板生成 KPI 卡片与图例。</span>"],
    "sc.title": ["Keyboard shortcuts", "键盘快捷键"],
    "sc.thA": ["Action", "操作"],
    "sc.thS": ["Shortcut", "快捷键"],
    "sc.save": ["Save As", "保存"],
    "sc.undo": ["Undo / Redo", "撤销 / 重做"],
    "sc.dup": ["Duplicate", "复制元素"],
    "sc.group": ["Group / Ungroup", "编组 / 解组"],
    "sc.lock": ["Lock / Unlock", "锁定 / 解锁"],
    "sc.style": ["Copy / Paste style", "复制 / 粘贴样式"],
    "sc.del": ["Delete", "删除"],
    "sc.parent": ["Select parent / Deselect", "选中父级 / 取消选中"],
    "sc.nudge": ["Nudge 1px / 10px", "微调 1px / 10px"],
    "faq.title": ["FAQ", "常见问题"],
    "faq.1q": ["Do I need to know HTML or CSS?", "需要懂 HTML 或 CSS 吗？"],
    "faq.1a": ["No — everything is point-and-click. If you do know HTML, you'll appreciate that the exported file stays clean and semantic.", "不需要 —— 所有操作都是点击与拖拽。如果你懂 HTML，则会欣赏导出文件的干净与语义化。"],
    "faq.2q": ["Is it really free? Any sign-up?", "真的免费吗？需要注册吗？"],
    "faq.2a": ["Yes and no — no accounts, no trials, no paywalls. It's a plain HTML/JS app you can even run from a local file.", "真免费 —— 无账号、无试用、无付费墙。这是一个纯 HTML/JS 应用，甚至可以直接从本地文件运行。"],
    "faq.3q": ["Where does my content go?", "我的内容会上传到哪里？"],
    "faq.3a": ["Nowhere. All editing happens in this browser tab; nothing is uploaded. Save As writes a clean HTML file to your computer.", "哪儿都不去。所有编辑都发生在这个浏览器标签页里，不上传任何数据。「保存」会把干净的 HTML 文件写到你的电脑上。"],
    "faq.4q": ["Can I edit existing pages?", "能编辑已有的网页吗？"],
    "faq.4a": ["Yes — click <b>Open</b> (or Ctrl+O), pick any local .html file, and edit it visually.", "可以 —— 点击<b>打开</b>（或 Ctrl+O），选择任意本地 .html 文件，即可可视化编辑。"],
    "faq.5q": ["Does it work offline?", "离线能用吗？"],
    "faq.5a": ["After the page loads, you can go offline and keep editing. (Only one-click PDF export needs the network for its rendering libraries — printing works offline.)", "页面加载完成后即可断网继续编辑。（仅一键导出 PDF 需联网加载渲染库 —— 打印导出离线可用。）"],
    "cmp.title": ["Why this editor?", "为什么选择它？"],
    "cmp.l1": ["Free forever", "永久免费"],
    "cmp.l2": ["Accounts required", "需要注册"],
    "cmp.v3": ["Local", "本地"],
    "cmp.l3": ["Your data stays put", "数据不出浏览器"],
    "cmp.v4": ["Clean", "干净"],
    "cmp.l4": ["Semantic output", "语义化输出"],
    "cta2.title": ["Start editing right now", "现在就开始编辑"],
    "cta2.sub": ["No download, no credit card. Every element on this page is live — try moving this banner.", "无需下载、无需信用卡。这个页面上的每个元素都是活的 —— 试着拖动这个横幅吧。"],
    "cta2.btn": ["✏️ Enter edit mode", "✏️ 进入编辑模式"],
    "f.p1": ["A from-scratch, dependency-free recreation of the classic in-browser visual HTML editor.", "一个从零实现、零依赖的浏览器可视化 HTML 编辑器。"],
    "f.p2": ["All editing happens locally in your browser — no data is ever uploaded.", "所有编辑都在你的浏览器本地完成 —— 绝不上传任何数据。"],
  };

  /** Translate a UI string (English key) into the active language. */
  function t(s, vars) {
    let out = (state.lang === 'zh' && Object.prototype.hasOwnProperty.call(I18N_ZH, s)) ? I18N_ZH[s] : s;
    if (vars) for (const k in vars) out = out.split('{' + k + '}').join(String(vars[k]));
    return out;
  }

  /** Swap <html lang>, <title> and meta description. */
  function applyHeadLang() {
    const zh = state.lang === 'zh';
    document.documentElement.lang = zh ? 'zh-CN' : 'en';
    const tt = DOC_I18N['doc.title'];
    if (tt && (document.title === tt[0] || document.title === tt[1])) {
      document.title = tt[zh ? 1 : 0];
    }
    const dd = DOC_I18N['doc.desc'];
    const md = document.querySelector('meta[name="description"]');
    if (md && dd) {
      const cur = md.getAttribute('content') || '';
      if (cur === dd[0] || cur === dd[1]) md.setAttribute('content', dd[zh ? 1 : 0]);
    }
  }

  /** Translate every [data-i18n] element; user-modified text is preserved. */
  function applyDocumentLang() {
    const zh = state.lang === 'zh';
    document.querySelectorAll('[data-i18n]').forEach(n => {
      const pair = DOC_I18N[n.getAttribute('data-i18n')];
      if (!pair) return;
      const cur = n.innerHTML;
      if (cur === pair[0] || cur === pair[1]) n.innerHTML = pair[zh ? 1 : 0];
    });
  }

  /** Switch the whole interface + document language. */
  function setLang(lang) {
    if (lang !== 'zh' && lang !== 'en') return;
    if (state.lang === lang) return;
    state.lang = lang;
    try { localStorage.setItem('hve-lang', lang); } catch (err) { /* private mode */ }
    if (state.editingEl) exitTextEdit();
    closeDropdown();
    applyHeadLang();
    applyDocumentLang();
    refreshStaticUI();
  }

  /** Re-render the static UI chrome after a language switch. */
  function refreshStaticUI() {
    if (!controlBar) return;
    const set = (sel, title, label) => {
      const b = $(sel, controlBar);
      if (!b) return;
      if (title) b.title = title;
      if (label) { const s = b.querySelector('span:not(.hve-cb-lang-x)'); if (s) s.textContent = label; }
    };
    const eb = $('#hve-cb-edit', controlBar);
    if (eb) {
      eb.title = t('Toggle edit mode');
      const l = eb.querySelector('span');
      if (l) l.textContent = state.editMode ? t('Editing') : t('Edit');
    }
    set('#hve-cb-open', t('Open a local HTML file (Ctrl+O)'), t('Open'));
    set('#hve-cb-save', t('Download clean HTML (Ctrl+S)'), t('Save As'));
    set('#hve-cb-pdf', t('Export as PDF'), 'PDF');
    const small = controlBar.querySelector('.hve-logo-text small');
    if (small) small.textContent = t('free · in-browser · no sign-up');
    const langLabel = $('#hve-cb-lang-label');
    if (langLabel) langLabel.textContent = state.lang === 'zh' ? 'EN' : '中文';
    if (statusBtn) {
      statusBtn.title = t('Toggle edit mode');
      const st = $('#hve-status-text');
      if (st) st.textContent = state.editMode ? t('Editing · click to pause') : t('View mode');
    }
    buildToolbarContent();
    if (quickAddBtn) quickAddBtn.title = t('Insert an element here');
    const dropSpan = dropOverlay && dropOverlay.querySelector('span');
    if (dropSpan) dropSpan.textContent = t('Drop images to insert');
    if (state.selected.length > 1) showMultiToast();
    renderPanels();
    updateToolbarState();
    updateHistoryButtons();
  }

  /* ---------------------------------------------------------
   * 2. Small utilities
   * ------------------------------------------------------- */

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  function el(tag, attrs, html) {
    const n = document.createElement(tag);
    if (attrs) for (const k in attrs) {
      if (k === 'style') n.style.cssText = attrs[k];
      else if (k === 'class') n.className = attrs[k];
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), attrs[k]);
      else n.setAttribute(k, attrs[k]);
    }
    if (html != null) n.innerHTML = html;
    return n;
  }

  function isUI(node) {
    if (!node || node.nodeType !== 1) return false;
    return node.closest && node.closest('[data-hve-ui]') !== null;
  }

  function isSelectable(node) {
    if (!node || node.nodeType !== 1) return false;
    if (node === document.body || node === document.documentElement) return false;
    if (isUI(node)) return false;
    if (['HTML', 'HEAD', 'SCRIPT', 'STYLE', 'LINK', 'META', 'TITLE'].includes(node.tagName)) return false;
    return true;
  }

  function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

  function isMac() { return /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent); }
  function modKey(e) { return isMac() ? e.metaKey : e.ctrlKey; }

  function stripMarks(root, keepPersistent) {
    const all = [root, ...root.querySelectorAll('*')];
    for (const n of all) {
      if (!n.attributes) continue;
      Array.from(n.attributes).forEach(a => {
        if (a.name.startsWith('data-hve-')) {
          if (keepPersistent && PERSISTENT_MARKS.has(a.name)) return;
          n.removeAttribute(a.name);
        }
      });
      if (n.hasAttribute && n.hasAttribute('data-hve-editing')) {
        n.removeAttribute('contenteditable');
      }
    }
  }

  /* ---------------------------------------------------------
   * 3. Toasts
   * ------------------------------------------------------- */

  function toast(msg, type) {
    if (!toastWrap) return;
    const node = el('div', { class: 'hve-toast ' + (type || 'info') },
      '<span class="hve-toast-dot"></span><span></span>');
    node.lastChild.textContent = msg;
    toastWrap.appendChild(node);
    setTimeout(() => {
      node.classList.add('hve-toast-out');
      setTimeout(() => node.remove(), 260);
    }, 2400);
  }

  /* ---------------------------------------------------------
   * 4. Undo / redo
   * ------------------------------------------------------- */

  function snapshotHTML() {
    const clone = document.body.cloneNode(true);
    clone.querySelectorAll('[data-hve-ui]').forEach(n => n.remove());
    stripMarks(clone, true);
    return clone.innerHTML;
  }

  function pushUndo(coalesceKey) {
    const now = Date.now();
    const top = state.undoStack[state.undoStack.length - 1];
    if (coalesceKey && top && top.key === coalesceKey && now - top.t < 1200) {
      top.t = now;
      return;
    }
    state.undoStack.push({
      html: snapshotHTML(),
      key: coalesceKey || null,
      t: now,
      sx: window.scrollX, sy: window.scrollY
    });
    if (state.undoStack.length > UNDO_LIMIT) state.undoStack.shift();
    state.redoStack.length = 0;
    updateHistoryButtons();
  }

  function applySnapshot(snap) {
    if (state.editingEl) exitTextEdit();
    clearSelection();
    closeAllPanels(true);
    Array.from(document.body.childNodes).forEach(n => { if (n !== uiRoot) n.remove(); });
    const tpl = document.createElement('template');
    tpl.innerHTML = snap.html;
    document.body.insertBefore(tpl.content, uiRoot);
    window.scrollTo(snap.sx || 0, snap.sy || 0);
  }

  function undo() {
    if (!state.undoStack.length) return;
    state.redoStack.push({
      html: snapshotHTML(), key: null, t: Date.now(),
      sx: window.scrollX, sy: window.scrollY
    });
    const snap = state.undoStack.pop();
    applySnapshot(snap);
    updateHistoryButtons();
    toast(t('Undo'), 'info');
  }

  function redo() {
    if (!state.redoStack.length) return;
    state.undoStack.push({
      html: snapshotHTML(), key: null, t: Date.now(),
      sx: window.scrollX, sy: window.scrollY
    });
    const snap = state.redoStack.pop();
    applySnapshot(snap);
    updateHistoryButtons();
    toast(t('Redo'), 'info');
  }

  function updateHistoryButtons() {
    const u = $('#hve-tb-undo'), r = $('#hve-tb-redo');
    if (u) u.disabled = !state.undoStack.length;
    if (r) r.disabled = !state.redoStack.length;
  }

  /* ---------------------------------------------------------
   * 5. Selection
   * ------------------------------------------------------- */

  function clearHover() {
    if (state.hovered) {
      state.hovered.removeAttribute('data-hve-hovered');
      state.hovered = null;
    }
  }

  function setHover(node) {
    if (state.hovered === node) return;
    clearHover();
    if (node && isSelectable(node)) {
      if (node.closest('[data-hve-locked]')) return;
      if (state.editingEl && (node === state.editingEl || state.editingEl.contains(node))) return;
      state.hovered = node;
      node.setAttribute('data-hve-hovered', '');
    }
  }

  function clearSelection() {
    state.selected.forEach(s => {
      s.removeAttribute('data-hve-selected');
      s.removeAttribute('data-hve-multi-selected');
    });
    state.selected = [];
    state.primary = null;
    hideResizeBox();
    hideMultiToast();
    updateToolbarState();
  }

  function setSelection(els, opts) {
    opts = opts || {};
    if (state.editingEl) exitTextEdit();

    let list;
    if (opts.add) {
      list = state.selected.slice();
      els.forEach(e => { if (!list.includes(e)) list.push(e); });
    } else if (opts.toggle) {
      list = state.selected.slice();
      els.forEach(e => {
        const i = list.indexOf(e);
        if (i >= 0) list.splice(i, 1); else list.push(e);
      });
    } else {
      list = els.slice();
    }
    list = list.filter(e => e.isConnected);
    if (!list.length) { clearSelection(); return; }

    state.selected.forEach(s => {
      s.removeAttribute('data-hve-selected');
      s.removeAttribute('data-hve-multi-selected');
    });
    state.selected = list;
    state.primary = list[list.length - 1];

    list.forEach((s, i) => {
      s.setAttribute(i === 0 ? 'data-hve-selected' : 'data-hve-multi-selected', '');
    });

    if (list.length === 1) showResizeBox(list[0]);
    else hideResizeBox();
    if (list.length > 1) showMultiToast(); else hideMultiToast();
    updateToolbarState();
  }

  function selectionTargetFrom(node) {
    let n = node;
    while (n && n !== document.body && n !== document.documentElement) {
      if (isUI(n)) return null;
      // locked elements stay selectable (so they can be unlocked) —
      // drag/resize are disabled elsewhere
      let group = null, p = n;
      while (p && p !== document.body) { // outermost group wins
        if (p.hasAttribute && p.hasAttribute('data-hve-group')) group = p;
        p = p.parentElement;
      }
      if (group) return group;
      if (isSelectable(n)) return n;
      n = n.parentElement;
    }
    return null;
  }

  /* ---------------------------------------------------------
   * 6. Icons
   * ------------------------------------------------------- */

  const svgIcon = (inner, fill) =>
    '<svg viewBox="0 0 24 24" width="15" height="15" fill="' + (fill || 'none') +
    '" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    inner + '</svg>';

  const ICONS = {
    edit: svgIcon('<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/>'),
    folder: svgIcon('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>'),
    save: svgIcon('<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/>'),
    pdf: svgIcon('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><path d="M12 18v-6"/><path d="M9 15l3 3 3-3"/>'),
    alignLeft: svgIcon('<line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="12" x2="14" y2="12"/><line x1="4" y1="18" x2="17" y2="18"/>'),
    alignCenter: svgIcon('<line x1="4" y1="6" x2="20" y2="6"/><line x1="7" y1="12" x2="17" y2="12"/><line x1="5" y1="18" x2="19" y2="18"/>'),
    alignRight: svgIcon('<line x1="4" y1="6" x2="20" y2="6"/><line x1="10" y1="12" x2="20" y2="12"/><line x1="7" y1="18" x2="20" y2="18"/>'),
    plus: svgIcon('<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>'),
    brush: svgIcon('<path d="M9.06 11.9l8.07-8.06a2.85 2.85 0 1 1 4.03 4.03l-8.06 8.08"/><path d="M7.07 14.94c-1.66 0-3 1.35-3 3.02 0 1.33-2.5 1.52-2 2.02 1.08 1.1 2.49 2.02 4 2.02 2.2 0 4-1.8 4-4.04a3.01 3.01 0 0 0-3-3.02z"/>'),
    copy: svgIcon('<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>'),
    arrowUp: svgIcon('<line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/>'),
    arrowDown: svgIcon('<line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/>'),
    lock: svgIcon('<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>'),
    trash: svgIcon('<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>'),
    layers: svgIcon('<polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/>'),
    chart: svgIcon('<line x1="6" y1="20" x2="6" y2="14"/><line x1="12" y1="20" x2="12" y2="8"/><line x1="18" y1="20" x2="18" y2="4"/><line x1="3" y1="20" x2="21" y2="20"/>'),
    undo: svgIcon('<path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-15-6.7L3 13"/>'),
    redo: svgIcon('<path d="M21 7v6h-6"/><path d="M3 17a9 9 0 0 1 15-6.7L21 13"/>'),
    radius: svgIcon('<rect x="4" y="4" width="16" height="16" rx="6"/>'),
    shadow: svgIcon('<rect x="3" y="3" width="12" height="12" rx="2"/><rect x="9" y="9" width="12" height="12" rx="2"/>'),
    opacity: svgIcon('<circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor" stroke="none"/>'),
    drop: svgIcon('<path d="M12 2.7l5.66 5.66a8 8 0 1 1-11.31 0z"/>')
  };

  /* ---------------------------------------------------------
   * 7. UI construction
   * ------------------------------------------------------- */

  function buildUI() {
    uiRoot = el('div', { id: 'hve-ui-root', 'data-hve-ui': '', 'class': 'hve-ui-root' });
    document.body.appendChild(uiRoot);

    /* ---- control bar ---- */
    controlBar = el('div', { 'class': 'hve-controlbar', 'data-hve-ui': '' });
    controlBar.innerHTML = `
      <div class="hve-logo">
        <div class="hve-logo-mark">HVE</div>
        <div class="hve-logo-text">${t('Visual HTML Editor')}<small>${t('free · in-browser · no sign-up')}</small></div>
      </div>
      <button class="hve-cb-btn" id="hve-cb-edit" title="${t('Toggle edit mode')}">${ICONS.edit}<span>${t('Edit')}</span></button>
      <button class="hve-cb-btn" id="hve-cb-open" title="${t('Open a local HTML file (Ctrl+O)')}">${ICONS.folder}<span>${t('Open')}</span></button>
      <button class="hve-cb-btn" id="hve-cb-save" title="${t('Download clean HTML (Ctrl+S)')}">${ICONS.save}<span>${t('Save As')}</span></button>
      <button class="hve-cb-btn" id="hve-cb-pdf" title="${t('Export as PDF')}">${ICONS.pdf}<span>PDF</span></button>
      <button class="hve-cb-btn" id="hve-cb-lang" title="English / 中文" aria-label="English / 中文"><span class="hve-cb-lang-label" id="hve-cb-lang-label">${state.lang === 'zh' ? 'EN' : '中文'}</span></button>
      <div class="hve-cb-spacer"></div>
      <span class="hve-cb-filename" id="hve-cb-filename"></span>`;
    uiRoot.appendChild(controlBar);
    $('#hve-cb-edit', controlBar).addEventListener('click', () => toggleEditMode());
    $('#hve-cb-open', controlBar).addEventListener('click', () => openFilePicker());
    $('#hve-cb-save', controlBar).addEventListener('click', () => saveAs());
    $('#hve-cb-pdf', controlBar).addEventListener('click', () => togglePanel('pdf'));
    $('#hve-cb-lang', controlBar).addEventListener('click', () => setLang(state.lang === 'zh' ? 'en' : 'zh'));

    /* ---- floating toolbar ---- */
    toolbar = el('div', { 'class': 'hve-toolbar', 'data-hve-ui': '', 'role': 'toolbar' });
    buildToolbarContent();
    uiRoot.appendChild(toolbar);

    toolbar.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-hve-action]');
      if (!b) return;
      handleToolbarAction(b.dataset.hveAction, b);
    });
    toolbar.addEventListener('dblclick', (e) => {
      const b = e.target.closest('button[data-hve-action]');
      if (b && b.dataset.hveAction === 'brush') armBrush(true);
    });

    /* ---- status pill ---- */
    statusBtn = el('button', { 'class': 'hve-status', 'data-hve-ui': '', title: t('Toggle edit mode') },
      '<span class="hve-status-dot"></span><span id="hve-status-text">' + t('View mode') + '</span>');
    statusBtn.addEventListener('click', () => toggleEditMode());
    uiRoot.appendChild(statusBtn);

    /* ---- toast wrap ---- */
    toastWrap = el('div', { 'class': 'hve-toast-wrap', 'data-hve-ui': '' });
    uiRoot.appendChild(toastWrap);

    /* ---- resize box ---- */
    resizeBox = el('div', { 'class': 'hve-resize-box', 'data-hve-ui': '' });
    ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'].forEach(pos => {
      const h = el('div', { 'class': 'hve-rz-handle hve-rz-' + pos, 'data-hve-pos': pos });
      h.addEventListener('mousedown', startResize);
      resizeBox.appendChild(h);
    });
    uiRoot.appendChild(resizeBox);
    hideResizeBox();

    /* ---- multi-select toast ---- */
    multiToast = el('div', { 'class': 'hve-multi-toast', 'data-hve-ui': '' });
    multiToast.style.display = 'none';
    uiRoot.appendChild(multiToast);

    /* ---- overlays ---- */
    dragGhost = el('div', { 'class': 'hve-drag-ghost', 'data-hve-ui': '' });
    dragGhost.style.display = 'none';
    uiRoot.appendChild(dragGhost);

    insertIndicator = el('div', { 'class': 'hve-insert-indicator', 'data-hve-ui': '' });
    insertIndicator.style.display = 'none';
    uiRoot.appendChild(insertIndicator);

    marqueeEl = el('div', { 'class': 'hve-marquee', 'data-hve-ui': '' });
    marqueeEl.style.display = 'none';
    uiRoot.appendChild(marqueeEl);

    quickAddBtn = el('button', { 'class': 'hve-quick-add', 'data-hve-ui': '', title: t('Insert an element here') }, '+');
    quickAddBtn.style.display = 'none';
    quickAddBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const r = quickAddBtn.getBoundingClientRect();
      hideQuickAdd();
      openInsertPanel(r.left, r.top);
    });
    uiRoot.appendChild(quickAddBtn);

    dropOverlay = el('div', { 'class': 'hve-drop-overlay', 'data-hve-ui': '' },
      '<div class="hve-drop-card"><div style="font-size:34px">🖼️</div><span>' + t('Drop images to insert') + '</span></div>');
    dropOverlay.style.display = 'none';
    uiRoot.appendChild(dropOverlay);

    requestAnimationFrame(tick);
  }

  /* (Re)build the toolbar contents — called on init and on language switch. */
  function buildToolbarContent() {
    const btn = (id, html, title) =>
      `<button id="hve-tb-${id}" data-hve-action="${id}" title="${title}" aria-label="${title}">${html}</button>`;

    const groups = [
      btn('bold', '<span class="hve-tb-bold">B</span>', t('Bold (Ctrl+B)')) +
      btn('italic', '<span class="hve-tb-italic">I</span>', t('Italic (Ctrl+I)')) +
      btn('underline', '<span class="hve-tb-underline">U</span>', t('Underline (Ctrl+U)')) +
      btn('strike', '<span class="hve-tb-strike">S</span>', t('Strikethrough')),

      `<select class="hve-tb-select" id="hve-tb-font" title="${t('Font family')}"></select>` +
      `<select class="hve-tb-select" id="hve-tb-size" title="${t('Font size')}"></select>` +
      `<select class="hve-tb-select" id="hve-tb-heading" title="${t('Paragraph / heading level')}"></select>`,

      btn('align-left', ICONS.alignLeft, t('Align left')) +
      btn('align-center', ICONS.alignCenter, t('Align center')) +
      btn('align-right', ICONS.alignRight, t('Align right')),

      btn('color', '<span style="font-weight:700;font-size:14px">A</span><span class="hve-color-swatch" id="hve-swatch-text"></span>', t('Text color')) +
      btn('bg-color', ICONS.drop + '<span class="hve-color-swatch" id="hve-swatch-bg"></span>', t('Background color')),

      btn('radius', ICONS.radius, t('Border radius')) +
      btn('shadow', ICONS.shadow, t('Box shadow')) +
      btn('opacity', ICONS.opacity, t('Opacity')),

      btn('insert', ICONS.plus, t('Insert element')) +
      btn('brush', ICONS.brush, t('Format brush — double-click for continuous mode')) +
      btn('duplicate', ICONS.copy, t('Duplicate (Ctrl+D)')) +
      btn('move-up', ICONS.arrowUp, t('Move earlier in container')) +
      btn('move-down', ICONS.arrowDown, t('Move later in container')) +
      btn('lock', ICONS.lock, t('Lock / unlock (Ctrl+L)')) +
      btn('delete', ICONS.trash, t('Delete (Del)')),

      btn('pages', ICONS.layers, t('Page sorter (Ctrl+Shift+P)')) +
      btn('chart', ICONS.chart, t('Chart typography panel')) +
      btn('undo', ICONS.undo, t('Undo (Ctrl+Z)')) +
      btn('redo', ICONS.redo, t('Redo (Ctrl+Y)'))
    ];

    toolbar.innerHTML = groups.map(html =>
      `<span class="hve-tb-group">${html}</span>`).join('<span class="hve-tb-sep"></span>');

    const fontSel = $('#hve-tb-font', toolbar);
    FONT_OPTIONS.forEach(f => fontSel.add(new Option(t(f.label), f.value)));
    const sizeSel = $('#hve-tb-size', toolbar);
    SIZE_OPTIONS.forEach(s => sizeSel.add(new Option(s + 'px', s + 'px')));
    const headSel = $('#hve-tb-heading', toolbar);
    HEADING_OPTIONS.forEach(h => headSel.add(new Option(t(h.label), h.value)));

    fontSel.addEventListener('change', () => applyFontFamily(fontSel.value));
    sizeSel.addEventListener('change', () => applyFontSize(sizeSel.value));
    headSel.addEventListener('change', () => applyHeading(headSel.value));
  }

  function tick() {
    if (resizeBox.style.display !== 'none' && state.selected.length === 1) {
      if (state.selected[0].isConnected) positionResizeBox(state.selected[0]);
      else hideResizeBox();
    }
    requestAnimationFrame(tick);
  }

  /* ---------------------------------------------------------
   * 8. Edit mode toggle
   * ------------------------------------------------------- */

  function toggleEditMode(force) {
    const target = (force === undefined) ? !state.editMode : force;
    state.editMode = target;
    document.documentElement.classList.toggle('hve-on', target);
    const eb = $('#hve-cb-edit');
    if (eb) {
      eb.classList.toggle('active', target);
      const label = eb.querySelector('span');
      if (label) label.textContent = target ? t('Editing') : t('Edit');
    }
    const st = $('#hve-status-text');
    if (st) st.textContent = target ? t('Editing · click to pause') : t('View mode');
    if (!target) {
      if (state.editingEl) exitTextEdit();
      clearSelection();
      clearHover();
      closeAllPanels(true);
      closeDropdown();
      hideQuickAdd();
      disarmBrush();
    }
  }

  /* ---------------------------------------------------------
   * 9. Hover + mouse selection
   * ------------------------------------------------------- */

  function onMouseOver(e) {
    if (!state.editMode || state.dragging || state.resizing) return;
    if (isUI(e.target)) return;
    const ht = e.target;
    if (ht === document.body || ht === document.documentElement) { clearHover(); return; }
    setHover(ht);
  }

  function onMouseDown(e) {
    if (!state.editMode || e.button !== 0) return;
    if (isUI(e.target)) return;

    // format brush armed: a click applies the copied styles
    if (state.brush) {
      const bt = selectionTargetFrom(e.target);
      if (bt) { applyBrushTo(bt); e.preventDefault(); return; }
    }

    // click outside ends text editing
    if (state.editingEl && !state.editingEl.contains(e.target)) exitTextEdit();
    if (state.editingEl && state.editingEl.contains(e.target)) return; // native caret

    const target = selectionTargetFrom(e.target);
    if (target) {
      const multi = e.ctrlKey || e.metaKey;
      const toggle = e.shiftKey;
      if (multi || toggle) {
        setSelection([target], { add: multi, toggle });
      } else if (!state.selected.includes(target)) {
        setSelection([target]);
      } else {
        state.primary = target; // keep multi-selection intact for group drag
      }
      hideQuickAdd();
      armDrag(e, state.selected.includes(target) ? state.selected : [target]);
      e.preventDefault();
    } else if (e.target === document.body || e.target === document.documentElement) {
      armMarquee(e);
      e.preventDefault();
    }
  }

  /* ---------------------------------------------------------
   * 10. Drag & move (flow reorder + free float + guides)
   * ------------------------------------------------------- */

  function armDrag(e, elements) {
    const startX = e.clientX, startY = e.clientY;
    const els = elements.filter(x => x && x.isConnected && !x.closest('[data-hve-locked]'));
    if (!els.length) return;

    function onMove(ev) {
      if (!state.dragging && Math.hypot(ev.clientX - startX, ev.clientY - startY) > DRAG_THRESHOLD) {
        beginDrag(els, startX, startY);
      }
      if (state.dragging) updateDrag(ev);
    }
    function onUp(ev) {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      if (state.dragging) endDrag(ev);
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  function isFloating(el) {
    return el.getAttribute('data-hve-floating') !== null || el.style.position === 'absolute';
  }

  function beginDrag(els, startX, startY) {
    pushUndo();
    clearHover();
    hideQuickAdd();
    hideResizeBox();

    const floating = els.length === 1 && isFloating(els[0]);
    state.dragging = { els, floating, startX, startY, guideEls: [] };

    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'grabbing';

    if (floating) {
      const s = els[0].style;
      state.dragging.baseLeft = parseFloat(s.left) || 0;
      state.dragging.baseTop = parseFloat(s.top) || 0;
      state.dragging.baseRect = els[0].getBoundingClientRect(); // frame of reference for snapping
    } else {
      const r = els[0].getBoundingClientRect();
      if (els.length === 1) {
        dragGhost.innerHTML = els[0].outerHTML;
        const gs = dragGhost.firstElementChild;
        if (gs) { gs.style.width = r.width + 'px'; gs.style.height = r.height + 'px'; gs.style.margin = '0'; }
      } else {
        dragGhost.innerHTML = '';
        const box = document.createElement('div');
        box.style.cssText = 'width:100%;height:100%;border:2px dashed #cc785c;border-radius:10px;' +
          'background:rgba(204,120,92,0.08);display:flex;align-items:center;justify-content:center;' +
          'color:#cc785c;font:600 13px -apple-system,sans-serif;';
        box.textContent = t('{n} elements', { n: els.length });
        dragGhost.appendChild(box);
      }
      dragGhost.style.width = r.width + 'px';
      dragGhost.style.height = r.height + 'px';
      dragGhost.style.display = 'block';
      state.dragging.grabDX = startX - r.left;
      state.dragging.grabDY = startY - r.top;
      els.forEach(x => x.setAttribute('data-hve-dragging-source', ''));
    }
  }

  function updateDrag(ev) {
    const d = state.dragging;
    if (!d) return;

    if (d.floating) {
      let dx = ev.clientX - d.startX;
      let dy = ev.clientY - d.startY;
      const el = d.els[0];
      // snap against the *original* rect + total delta (not the already-moved rect)
      const snap = computeSnap(el, d.baseRect, dx, dy);
      dx = snap.dx; dy = snap.dy;
      el.style.left = (d.baseLeft + dx) + 'px';
      el.style.top = (d.baseTop + dy) + 'px';
      drawGuides(snap.guides);
    } else {
      dragGhost.style.left = (ev.clientX - d.grabDX) + 'px';
      dragGhost.style.top = (ev.clientY - d.grabDY) + 'px';
      d.drop = computeDrop(ev.clientX, ev.clientY, d.els);
      drawInsertIndicator(d.drop);
    }
  }

  function endDrag() {
    const d = state.dragging;
    if (!d) return;
    state.dragging = null;

    document.body.style.userSelect = '';
    document.body.style.cursor = '';
    dragGhost.style.display = 'none';
    dragGhost.innerHTML = '';
    insertIndicator.style.display = 'none';
    clearGuides(d.guideEls);

    d.els.forEach(x => x.removeAttribute('data-hve-dragging-source'));

    if (!d.floating && d.drop) {
      const { container, ref } = d.drop;
      const valid = d.els.every(x => x !== container && !x.contains(container));
      if (valid) {
        let prev = null;
        d.els.forEach(x => {
          if (prev) prev.insertAdjacentElement('afterend', x);
          else if (ref) container.insertBefore(x, ref);
          else container.appendChild(x);
          prev = x;
        });
      }
    }
    setSelection(d.els);
  }

  /* ---- drop target computation ---- */

  function computeDrop(x, y, dragged) {
    let target = null;
    const stack = document.elementsFromPoint(x, y);
    for (const e of stack) {
      if (e === document.documentElement || e === document.body) { target = document.body; break; }
      if (isUI(e)) continue;
      if (dragged.some(d => d === e || d.contains(e))) continue;
      target = e; break;
    }
    target = target || document.body;

    // climb out of inline elements to a block container
    let container = target;
    while (container && container !== document.body) {
      const disp = getComputedStyle(container).display;
      if (disp.startsWith('inline') && disp !== 'inline-flex') container = container.parentElement;
      else break;
    }
    container = container || document.body;
    if (dragged.some(d => container === d || d.contains(container))) {
      container = dragged[0].parentElement || document.body;
    }

    const children = Array.from(container.children).filter(c =>
      !isUI(c) && !dragged.includes(c) &&
      !['SCRIPT', 'STYLE', 'LINK', 'META'].includes(c.tagName) &&
      c.getBoundingClientRect().height > 0);

    let horiz = false;
    if (children.length >= 2) {
      const r0 = children[0].getBoundingClientRect();
      const r1 = children[1].getBoundingClientRect();
      horiz = Math.abs(r0.top - r1.top) < Math.min(r0.height, r1.height) * 0.5;
    }

    let ref = null;
    for (const c of children) {
      const r = c.getBoundingClientRect();
      const mid = horiz ? r.left + r.width / 2 : r.top + r.height / 2;
      if ((horiz ? x : y) < mid) { ref = c; break; }
    }
    return { container, ref, horiz, children };
  }

  function drawInsertIndicator(drop) {
    const ind = insertIndicator;
    ind.style.display = 'block';
    ind.classList.toggle('hve-insert-vertical', !!drop.horiz);

    let x, y, w, h;
    if (drop.ref) {
      const r = drop.ref.getBoundingClientRect();
      if (drop.horiz) {
        x = r.left - 2; y = r.top; w = 4; h = r.height;
      } else {
        x = r.left; y = r.top - 2; w = r.width; h = 4;
      }
    } else if (drop.children.length) {
      const last = drop.children[drop.children.length - 1];
      const r = last.getBoundingClientRect();
      if (drop.horiz) {
        x = r.right - 2; y = r.top; w = 4; h = r.height;
      } else {
        x = r.left; y = r.bottom - 2; w = r.width; h = 4;
      }
    } else {
      const r = drop.container.getBoundingClientRect();
      x = r.left + 8; y = Math.max(r.top, 8); w = Math.max(r.width - 16, 40); h = 4;
    }
    ind.style.left = x + 'px';
    ind.style.top = y + 'px';
    ind.style.width = w + 'px';
    ind.style.height = h + 'px';
  }

  /* ---- alignment guides & snapping (free drag) ---- */

  function computeSnap(dragged, rect, dx, dy) {
    const parent = dragged.parentElement || document.body;
    const siblings = Array.from(parent.children).filter(c =>
      c !== dragged && !isUI(c) && c.getBoundingClientRect().height > 0 &&
      c.getBoundingClientRect().width > 0);

    let newLeft = rect.left + dx, newTop = rect.top + dy;
    const guides = [];
    let adjX = null, adjY = null;

    for (const s of siblings) {
      const r = s.getBoundingClientRect();
      // vertical alignment candidates (x axis)
      const xCands = [
        { a: newLeft, b: r.left, mode: 'left' },
        { a: newLeft + rect.width / 2, b: r.left + r.width / 2, mode: 'center' },
        { a: newLeft + rect.width, b: r.right, mode: 'right' }
      ];
      for (const c of xCands) {
        if (Math.abs(c.a - c.b) < SNAP_PX) {
          const delta = c.b - c.a;
          if (adjX === null || Math.abs(delta) < Math.abs(adjX)) adjX = delta;
        }
      }
      const yCands = [
        { a: newTop, b: r.top, mode: 'top' },
        { a: newTop + rect.height / 2, b: r.top + r.height / 2, mode: 'center' },
        { a: newTop + rect.height, b: r.bottom, mode: 'bottom' }
      ];
      for (const c of yCands) {
        if (Math.abs(c.a - c.b) < SNAP_PX) {
          const delta = c.b - c.a;
          if (adjY === null || Math.abs(delta) < Math.abs(adjY)) adjY = delta;
        }
      }
    }

    if (adjX !== null) { dx += adjX; newLeft += adjX; }
    if (adjY !== null) { dy += adjY; newTop += adjY; }

    // build guide lines for remaining matches after snapping
    for (const s of siblings) {
      const r = s.getBoundingClientRect();
      if (Math.abs(newLeft - r.left) < 1 || Math.abs(newLeft + rect.width / 2 - (r.left + r.width / 2)) < 1 ||
          Math.abs(newLeft + rect.width - r.right) < 1) {
        guides.push({ type: 'v', x: r.left < newLeft ? r.left : newLeft, y1: Math.min(r.top, newTop), y2: Math.max(r.bottom, newTop + rect.height) });
      }
      if (Math.abs(newTop - r.top) < 1 || Math.abs(newTop + rect.height / 2 - (r.top + r.height / 2)) < 1 ||
          Math.abs(newTop + rect.height - r.bottom) < 1) {
        guides.push({ type: 'h', y: r.top < newTop ? r.top : newTop, x1: Math.min(r.left, newLeft), x2: Math.max(r.right, newLeft + rect.width) });
      }
    }
    // gap labels between the dragged element and nearest sibling
    for (const s of siblings) {
      const r = s.getBoundingClientRect();
      if (r.bottom <= newTop && Math.abs(newTop - r.bottom) < 120 && overlapsX(r, newLeft, newLeft + rect.width)) {
        guides.push({ type: 'label', x: (Math.max(r.left, newLeft) + Math.min(r.right, newLeft + rect.width)) / 2, y: (r.bottom + newTop) / 2, text: Math.round(newTop - r.bottom) + 'px' });
      } else if (r.top >= newTop + rect.height && Math.abs(r.top - (newTop + rect.height)) < 120 && overlapsX(r, newLeft, newLeft + rect.width)) {
        guides.push({ type: 'label', x: (Math.max(r.left, newLeft) + Math.min(r.right, newLeft + rect.width)) / 2, y: (newTop + rect.height + r.top) / 2, text: Math.round(r.top - newTop - rect.height) + 'px' });
      }
    }

    return { dx, dy, guides };
  }

  function overlapsX(r, x1, x2) {
    return r.left < x2 && r.right > x1;
  }

  function drawGuides(guides) {
    clearGuides(state.dragging && state.dragging.guideEls);
    if (!state.dragging) return;
    state.dragging.guideEls = [];
    for (const g of guides.slice(0, 8)) {
      let n;
      if (g.type === 'v') {
        n = el('div', { 'class': 'hve-guide hve-guide-v', 'data-hve-ui': '' });
        n.style.left = g.x + 'px';
        n.style.top = g.y1 + 'px';
        n.style.height = Math.max(g.y2 - g.y1, 12) + 'px';
      } else if (g.type === 'h') {
        n = el('div', { 'class': 'hve-guide hve-guide-h', 'data-hve-ui': '' });
        n.style.top = g.y + 'px';
        n.style.left = g.x1 + 'px';
        n.style.width = Math.max(g.x2 - g.x1, 12) + 'px';
      } else {
        n = el('div', { 'class': 'hve-guide-label', 'data-hve-ui': '' }, '');
        n.textContent = g.text;
        n.style.left = g.x + 'px';
        n.style.top = g.y + 'px';
        n.style.transform = 'translate(-50%, -50%)';
      }
      uiRoot.appendChild(n);
      state.dragging.guideEls.push(n);
    }
  }

  function clearGuides(list) {
    (list || []).forEach(n => n.remove());
    if (state.dragging) state.dragging.guideEls = [];
  }

  /* ---------------------------------------------------------
   * 11. Resize handles
   * ------------------------------------------------------- */

  function showResizeBox(target) {
    if (!resizeBox) return;
    resizeBox.classList.toggle('hve-locked-box', target.hasAttribute('data-hve-locked'));
    resizeBox.style.display = 'block';
    positionResizeBox(target);
  }

  function hideResizeBox() {
    if (resizeBox) resizeBox.style.display = 'none';
    $$('.hve-size-label', uiRoot).forEach(n => n.remove());
  }

  function positionResizeBox(target) {
    if (!target.isConnected) return;
    const r = target.getBoundingClientRect();
    const b = resizeBox;
    b.style.left = r.left + 'px';
    b.style.top = r.top + 'px';
    b.style.width = r.width + 'px';
    b.style.height = r.height + 'px';
  }

  function startResize(e) {
    e.stopPropagation();
    e.preventDefault();
    if (!state.selected.length || state.selected.length !== 1) return;
    const target = state.selected[0];
    if (target.closest('[data-hve-locked]')) return;

    pushUndo();
    const pos = e.target.dataset.hvePos;
    const startRect = target.getBoundingClientRect();
    const startX = e.clientX, startY = e.clientY;
    const isImg = target.tagName === 'IMG';
    const ratio = startRect.width / Math.max(startRect.height, 1);

    const label = el('div', { 'class': 'hve-size-label', 'data-hve-ui': '' });
    uiRoot.appendChild(label);

    state.resizing = true;

    function onMove(ev) {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      let w = startRect.width, h = startRect.height;

      if (pos.includes('e')) w = startRect.width + dx;
      if (pos.includes('s')) h = startRect.height + dy;
      if (pos.includes('w')) { w = startRect.width - dx; }
      if (pos.includes('n')) { h = startRect.height - dy; }

      w = Math.max(w, 24);
      h = Math.max(h, 14);

      if (isImg && pos.length === 2) { // corners keep aspect ratio
        if (Math.abs(dx) > Math.abs(dy)) h = w / ratio; else w = h * ratio;
      }

      target.style.width = Math.round(w) + 'px';
      if (!isImg || pos.length === 2 || pos === 'e' || pos === 'w') {
        if (!['n', 's'].includes(pos)) target.style.height = Math.round(h) + 'px';
      }

      label.textContent = Math.round(w) + ' × ' + Math.round(h);
      label.style.left = (ev.clientX + 14) + 'px';
      label.style.top = (ev.clientY - 28) + 'px';
      positionResizeBox(target);
    }

    function onUp() {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      state.resizing = false;
      label.remove();
      updateToolbarState();
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  /* ---------------------------------------------------------
   * 12. Inline text editing
   * ------------------------------------------------------- */

  const TEXT_EDITABLE_SELECTOR = 'p,h1,h2,h3,h4,h5,h6,li,blockquote,td,th,a,button,span,figcaption,dt,dd,label,legend,strong,em,i,b,u,small,cite';

  function getTextEditable(node) {
    let n = node;
    while (n && n !== document.body && n !== document.documentElement) {
      if (isUI(n)) return null;
      if (n.matches && n.matches(TEXT_EDITABLE_SELECTOR)) return n;
      // containers with only inline content can be edited directly
      if ((n.tagName === 'DIV' || n.tagName === 'SECTION') && !hasBlockChild(n)) return n;
      n = n.parentElement;
    }
    return null;
  }

  function hasBlockChild(n) {
    return Array.from(n.children).some(c => {
      const d = getComputedStyle(c).display;
      return !d.startsWith('inline') && d !== 'inline-flex';
    });
  }

  function enterTextEdit(target, ev) {
    const editable = getTextEditable(target);
    if (!editable) return;
    if (state.editingEl) exitTextEdit();
    pushUndo('text:' + indexOfEl(editable));
    setSelection([editable], {});
    state.editingEl = editable;
    editable.setAttribute('contenteditable', 'true');
    editable.setAttribute('data-hve-editing', '');
    try { document.execCommand('styleWithCSS', false, true); } catch (_) {}
    editable.focus();
    if (ev) {
      // place the caret where the user clicked
      const range = document.caretRangeFromPoint ? document.caretRangeFromPoint(ev.clientX, ev.clientY) : null;
      if (range && editable.contains(range.startContainer)) {
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
      }
    }
    updateToolbarState();
  }

  function exitTextEdit() {
    const editable = state.editingEl;
    if (!editable) return;
    state.editingEl = null;
    if (editable.isConnected) {
      editable.removeAttribute('contenteditable');
      editable.removeAttribute('data-hve-editing');
      if (!editable.textContent.trim() && !editable.querySelector('img,br')) {
        editable.textContent = t('Text');
      }
    }
    updateToolbarState();
  }

  function indexOfEl(elm) {
    return Array.from(document.body.querySelectorAll('*')).indexOf(elm);
  }

  function isTextSelectionActive() {
    const sel = window.getSelection();
    return state.editingEl && sel && !sel.isCollapsed && state.editingEl.contains(sel.anchorNode);
  }

  function onDoubleClick(e) {
    if (!state.editMode || isUI(e.target)) return;
    if (e.target === document.body || e.target === document.documentElement) {
      // double-click on empty canvas: offer quick insert
      showQuickAdd(e.clientX, e.clientY);
      return;
    }
    const target = selectionTargetFrom(e.target);
    if (!target) return;
    enterTextEdit(target, e);
    e.preventDefault();
  }

  function showQuickAdd(x, y) {
    quickAddBtn.style.display = 'flex';
    quickAddBtn.style.left = clamp(x - 18, 8, window.innerWidth - 44) + 'px';
    quickAddBtn.style.top = clamp(y - 18, 66, window.innerHeight - 44) + 'px';
    // remember insertion point among top-level elements
    const topEls = topLevelElements();
    let ref = null;
    for (const t of topEls) {
      const r = t.getBoundingClientRect();
      if (y < r.bottom) { ref = t; break; }
    }
    state.quickAddRef = { container: document.body, ref };
  }

  function hideQuickAdd() {
    if (quickAddBtn) quickAddBtn.style.display = 'none';
  }

  /* ---------------------------------------------------------
   * 13. Toolbar actions
   * ------------------------------------------------------- */

  function handleToolbarAction(action, btn) {
    switch (action) {
      case 'bold': case 'italic': case 'underline': case 'strike':
        formatText(action); break;
      case 'align-left': setAlign('left'); break;
      case 'align-center': setAlign('center'); break;
      case 'align-right': setAlign('right'); break;
      case 'color': openColorPanel(btn, 'text'); break;
      case 'bg-color': openColorPanel(btn, 'background'); break;
      case 'radius': openSimpleMenu(btn, RADIUS_OPTIONS, 'borderRadius', 'Border radius'); break;
      case 'shadow': openSimpleMenu(btn, SHADOW_OPTIONS, 'boxShadow', 'Box shadow'); break;
      case 'opacity': openOpacityMenu(btn); break;
      case 'insert': openInsertPanel(); break;
      case 'brush': armBrush(false); break;
      case 'duplicate': duplicateSelection(); break;
      case 'move-up': moveSelection(-1); break;
      case 'move-down': moveSelection(1); break;
      case 'lock': toggleLock(); break;
      case 'delete': deleteSelection(); break;
      case 'pages': togglePanel('pages'); break;
      case 'chart': togglePanel('chart'); break;
      case 'undo': undo(); break;
      case 'redo': redo(); break;
    }
  }

  function forEachSelected(fn) {
    state.selected.filter(s => s.isConnected).forEach(fn);
    updateToolbarState();
  }

  function formatText(cmd) {
    if (isTextSelectionActive()) {
      try { document.execCommand(cmd === 'strike' ? 'strikeThrough' : cmd, false, null); } catch (_) {}
      return;
    }
    if (!state.selected.length) return;
    pushUndo();
    const map = {
      bold: { prop: 'fontWeight', on: '700', off: '400' },
      italic: { prop: 'fontStyle', on: 'italic', off: 'normal' },
      underline: { prop: 'textDecorationLine', on: 'underline', off: 'none' },
      strike: { prop: 'textDecorationLine', on: 'line-through', off: 'none' }
    };
    const m = map[cmd];
    const cur = state.selected[0] ? getComputedStyle(state.selected[0])[m.prop] : '';
    const isOn = cmd === 'bold' ? parseInt(cur) >= 600 : cur.includes(m.on);
    forEachSelected(elx => { elx.style[m.prop] = isOn ? m.off : m.on; });
  }

  function setAlign(mode) {
    if (!state.selected.length) return;
    pushUndo();
    forEachSelected(elx => { elx.style.textAlign = mode; });
  }

  function applyFontFamily(val) {
    if (!state.selected.length) return;
    pushUndo();
    forEachSelected(elx => { elx.style.fontFamily = val || ''; });
  }

  function applyFontSize(val) {
    if (!state.selected.length) return;
    pushUndo();
    forEachSelected(elx => { elx.style.fontSize = val; });
  }

  function applyHeading(tag) {
    if (!state.selected.length) return;
    pushUndo();
    const next = [];
    forEachSelected(old => {
      if (old.tagName === tag) return;
      const marks = ['data-hve-selected', 'data-hve-multi-selected', 'data-hve-hovered', 'data-hve-editing'];
      marks.forEach(m => old.removeAttribute(m));
      const nw = document.createElement(tag);
      Array.from(old.attributes).forEach(a => nw.setAttribute(a.name, a.value));
      while (old.firstChild) nw.appendChild(old.firstChild);
      old.replaceWith(nw);
      next.push(nw);
    });
    if (next.length) setSelection(next);
  }

  function applyColorValue(color, mode) {
    if (isTextSelectionActive() && mode === 'text') {
      try { document.execCommand('foreColor', false, color); } catch (_) {}
      updateToolbarState();
      return;
    }
    if (isTextSelectionActive() && mode === 'background') {
      try { document.execCommand('hiliteColor', false, color); } catch (_) {}
      updateToolbarState();
      return;
    }
    if (!state.selected.length) return;
    pushUndo();
    forEachSelected(elx => {
      if (mode === 'text') elx.style.color = color;
      else elx.style.backgroundColor = color;
    });
  }

  function duplicateSelection() {
    if (!state.selected.length) return;
    pushUndo();
    const clones = [];
    forEachSelected(s => {
      const c = s.cloneNode(true);
      ['data-hve-selected', 'data-hve-multi-selected', 'data-hve-hovered', 'data-hve-editing', 'contenteditable']
        .forEach(m => c.removeAttribute(m));
      if (s.style.position === 'absolute') {
        c.style.left = (parseFloat(s.style.left) || 0) + 24 + 'px';
        c.style.top = (parseFloat(s.style.top) || 0) + 24 + 'px';
      }
      s.insertAdjacentElement('afterend', c);
      clones.push(c);
    });
    if (clones.length) setSelection(clones);
    toast(t('Duplicated'), 'success');
  }

  function deleteSelection() {
    if (!state.selected.length) return;
    pushUndo();
    const n = state.selected.length;
    state.selected.forEach(s => s.remove());
    clearSelection();
    toast(n > 1 ? t('{n} elements deleted', { n }) : t('Element deleted'), 'info');
  }

  function moveSelection(dir) {
    if (!state.selected.length) return;
    pushUndo();
    forEachSelected(s => {
      if (dir < 0) {
        const prev = s.previousElementSibling;
        if (prev && prev !== uiRoot && !isUI(prev)) s.parentElement.insertBefore(s, prev);
      } else {
        const next = s.nextElementSibling;
        if (next && !isUI(next)) s.parentElement.insertBefore(s, next.nextElementSibling);
      }
    });
  }

  function toggleLock() {
    if (!state.selected.length) return;
    pushUndo();
    const locking = !state.selected[0].hasAttribute('data-hve-locked');
    forEachSelected(s => {
      if (locking) s.setAttribute('data-hve-locked', '');
      else s.removeAttribute('data-hve-locked');
    });
    if (locking) { showResizeBox(state.selected[0]); toast(t('Locked 🔒 — click again + Ctrl+L to unlock'), 'success'); }
    else { toast(t('Unlocked'), 'info'); }
    updateToolbarState();
  }

  /* ---- layer operations ---- */

  function ensurePositioned(s) {
    if (getComputedStyle(s).position === 'static') s.style.position = 'relative';
  }

  function siblingZRange(s) {
    let max = 0, min = 0;
    Array.from(s.parentElement.children).forEach(c => {
      if (isUI(c)) return;
      const z = parseInt(getComputedStyle(c).zIndex) || 0;
      max = Math.max(max, z); min = Math.min(min, z);
    });
    return { max, min };
  }

  function layerOp(op) {
    if (!state.selected.length) return;
    pushUndo();
    forEachSelected(s => {
      ensurePositioned(s);
      const cur = parseInt(getComputedStyle(s).zIndex) || 0;
      const { max, min } = siblingZRange(s);
      if (op === 'forward') s.style.zIndex = cur + 1;
      else if (op === 'backward') s.style.zIndex = cur - 1;
      else if (op === 'front') s.style.zIndex = max + 1;
      else if (op === 'back') s.style.zIndex = min - 1;
    });
    toast(t('Layer updated'), 'info');
  }

  /* ---- copy / paste / clear style ---- */

  function copyStyle() {
    if (!state.selected.length) return;
    state.styleClipboard = state.selected[0].style.cssText || '';
    toast(t('Style copied'), 'success');
  }

  function pasteStyle() {
    if (!state.selected.length || !state.styleClipboard) {
      if (!state.styleClipboard) toast(t('No style copied yet'), 'error');
      return;
    }
    pushUndo();
    forEachSelected(s => { s.style.cssText = state.styleClipboard; });
    toast(t('Style applied'), 'success');
  }

  function clearStyle() {
    if (!state.selected.length) return;
    pushUndo();
    forEachSelected(s => { s.removeAttribute('style'); });
    toast(t('Inline styles cleared'), 'info');
  }

  function copyInternal() {
    if (!state.selected.length) return;
    const clone = document.createElement('div');
    state.selected.forEach(s => {
      const c = s.cloneNode(true);
      stripMarks(c, false);
      clone.appendChild(c);
    });
    state.clipboardHTML = clone.innerHTML;
    toast(t('Copied {n} element(s)', { n: state.selected.length }), 'success');
  }

  function cutInternal() {
    if (!state.selected.length) return;
    copyInternal();
    deleteSelection();
  }

  function pasteInternal() {
    if (!state.clipboardHTML) { toast(t('Clipboard is empty'), 'error'); return; }
    pushUndo();
    const tpl = document.createElement('template');
    tpl.innerHTML = state.clipboardHTML;
    const nodes = Array.from(tpl.content.children);
    const anchor = state.selected[state.selected.length - 1];
    let prev = null;
    nodes.forEach(n => {
      if (prev) prev.insertAdjacentElement('afterend', n);
      else if (anchor && anchor.isConnected) anchor.insertAdjacentElement('afterend', n);
      else document.body.insertBefore(n, uiRoot);
      prev = n;
    });
    if (nodes.length) setSelection(nodes);
    toast(t('Pasted'), 'success');
  }

  /* ---- format brush ---- */

  function armBrush(continuous) {
    if (!state.selected.length && !state.brush) {
      toast(t('Select a styled element first'), 'error');
      return;
    }
    if (state.brush && !continuous) { disarmBrush(); return; }
    const src = state.selected[0];
    if (!src) return;
    const cs = getComputedStyle(src);
    const styles = {};
    BRUSH_PROPS.forEach(p => { styles[p] = cs[p]; });
    state.brush = { styles, continuous: !!continuous };
    document.documentElement.setAttribute('data-hve-format-brush-active', '');
    const b = $('#hve-tb-brush');
    if (b) b.classList.add('hve-brush-active');
    toast(continuous ? t('Continuous format brush — Esc to exit') : t('Format brush armed — click a target'), 'info');
  }

  function disarmBrush() {
    if (!state.brush) return;
    state.brush = null;
    document.documentElement.removeAttribute('data-hve-format-brush-active');
    const b = $('#hve-tb-brush');
    if (b) b.classList.remove('hve-brush-active');
  }

  function applyBrushTo(target) {
    pushUndo();
    const st = state.brush.styles;
    for (const p in st) {
      if (st[p]) target.style[p] = st[p];
    }
    toast(t('Style applied'), 'success');
    if (!state.brush.continuous) disarmBrush();
  }

  /* ---------------------------------------------------------
   * 14. Dropdown menus & color panel
   * ------------------------------------------------------- */

  let openMenuEl = null;

  function closeDropdown() {
    if (openMenuEl) { openMenuEl.remove(); openMenuEl = null; }
  }

  function positionNear(menu, anchor) {
    uiRoot.appendChild(menu);
    const r = anchor.getBoundingClientRect();
    const mw = menu.offsetWidth, mh = menu.offsetHeight;
    let left = r.left;
    let top = r.bottom + 6;
    if (left + mw > window.innerWidth - 8) left = window.innerWidth - mw - 8;
    if (top + mh > window.innerHeight - 8) top = Math.max(8, r.top - mh - 6);
    menu.style.left = Math.max(8, left) + 'px';
    menu.style.top = top + 'px';
  }

  function openSimpleMenu(anchor, options, cssProp, title) {
    if (!state.selected.length) return;
    closeDropdown();
    const cur = getComputedStyle(state.selected[0])[cssProp];
    const menu = el('div', { 'class': 'hve-dropdown', 'data-hve-ui': '' });
    menu.appendChild(el('div', { 'class': 'hve-dd-item', style: 'font-size:11px;color:#8e8b82;pointer-events:none;font-weight:600;letter-spacing:.5px;text-transform:uppercase' }, t(title)));
    options.forEach(o => {
      const item = el('div', { 'class': 'hve-dd-item' },
        `<span class="hve-dd-icon"></span><span></span>`);
      item.children[1].textContent = t(o.label);
      if (normStyle(cur) === normStyle(o.value)) item.style.background = '#efe9de';
      item.addEventListener('click', () => {
        pushUndo();
        forEachSelected(s => { s.style[cssProp] = o.value; });
        closeDropdown();
      });
      menu.appendChild(item);
    });
    openMenuEl = menu;
    positionNear(menu, anchor);
  }

  function normStyle(v) {
    return String(v || '').replace(/\s+/g, ' ').trim().toLowerCase();
  }

  function openOpacityMenu(anchor) {
    if (!state.selected.length) return;
    closeDropdown();
    const cur = getComputedStyle(state.selected[0]).opacity;
    const menu = el('div', { 'class': 'hve-dropdown', 'data-hve-ui': '', style: 'min-width:220px' });
    const row = el('div', { 'class': 'hve-dd-slider-row' });
    const slider = el('input', { type: 'range', min: '10', max: '100', step: '5', value: Math.round(parseFloat(cur) * 100) });
    const val = el('span', { 'class': 'hve-dd-slider-val' }, Math.round(parseFloat(cur) * 100) + '%');
    slider.addEventListener('input', () => {
      val.textContent = slider.value + '%';
      pushUndo('opacity');
      forEachSelected(s => { s.style.opacity = slider.value / 100; });
    });
    row.appendChild(el('label', {}, t('Opacity')));
    row.appendChild(slider);
    row.appendChild(val);
    menu.appendChild(row);
    openMenuEl = menu;
    positionNear(menu, anchor);
  }

  function openColorPanel(anchor, mode) {
    if (!state.selected.length && !isTextSelectionActive()) return;
    closeDropdown();
    const panel = el('div', { 'class': 'hve-color-panel', 'data-hve-ui': '' });
    const target = state.selected[0];
    const current = target ? getComputedStyle(target)[mode === 'text' ? 'color' : 'backgroundColor'] : '#cc785c';
    const currentHex = rgbToHex(current);

    panel.appendChild(el('div', { 'class': 'hve-cp-title' },
      mode === 'text' ? t('Text color') : t('Background color')));

    const grid = el('div', { 'class': 'hve-cp-grid' });
    COLOR_SWATCHES.forEach(c => {
      const sw = el('div', { 'class': 'hve-cp-swatch' + (c.toLowerCase() === currentHex ? ' active' : '') });
      sw.style.background = c;
      sw.addEventListener('click', () => {
        applyColorValue(c, mode);
        closeDropdown();
      });
      grid.appendChild(sw);
    });
    panel.appendChild(grid);

    const custom = el('div', { 'class': 'hve-cp-custom' });
    const native = el('input', { type: 'color', 'class': 'hve-cp-native', value: currentHex });
    const hex = el('input', { type: 'text', 'class': 'hve-cp-hex', value: currentHex, placeholder: '#rrggbb' });
    native.addEventListener('input', () => {
      hex.value = native.value.toUpperCase();
      applyColorValue(native.value, mode);
    });
    hex.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        let v = hex.value.trim();
        if (/^#?[0-9a-fA-F]{3}$/.test(v)) v = '#' + v.split('').map(x => x + x).join('');
        if (/^#?[0-9a-fA-F]{6}$/.test(v)) {
          if (!v.startsWith('#')) v = '#' + v;
          applyColorValue(v, mode);
          closeDropdown();
        } else toast(t('Invalid hex color'), 'error');
      }
    });
    custom.appendChild(native);
    custom.appendChild(hex);
    panel.appendChild(custom);

    openMenuEl = panel;
    positionNear(panel, anchor);
  }

  function rgbToHex(rgb) {
    const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(rgb || '');
    if (!m) return '#000000';
    return '#' + [1, 2, 3].map(i => parseInt(m[i]).toString(16).padStart(2, '0')).join('');
  }

  /* ---------------------------------------------------------
   * 15. Toolbar state refresh
   * ------------------------------------------------------- */

  function updateToolbarState() {
    if (!toolbar) return;
    const has = state.selected.length > 0;
    const single = state.selected[0];

    ['bold', 'italic', 'underline', 'strike', 'align-left', 'align-center', 'align-right',
      'color', 'bg-color', 'radius', 'shadow', 'opacity', 'brush', 'duplicate',
      'move-up', 'move-down', 'lock', 'delete'].forEach(id => {
      const b = $('#hve-tb-' + id);
      if (b) b.disabled = !has;
    });
    ['hve-tb-font', 'hve-tb-size', 'hve-tb-heading'].forEach(id => {
      const s = $('#' + id);
      if (s) s.disabled = !has;
    });

    if (single && single.isConnected) {
      const cs = getComputedStyle(single);
      const setAct = (id, on) => {
        const b = $('#hve-tb-' + id);
        if (b) b.classList.toggle('hve-active', !!on);
      };
      setAct('bold', parseInt(cs.fontWeight) >= 600);
      setAct('italic', cs.fontStyle === 'italic');
      setAct('underline', String(cs.textDecorationLine).includes('underline'));
      setAct('strike', String(cs.textDecorationLine).includes('line-through'));
      setAct('align-left', cs.textAlign === 'left' || cs.textAlign === 'start');
      setAct('align-center', cs.textAlign === 'center');
      setAct('align-right', cs.textAlign === 'right' || cs.textAlign === 'end');

      const fontSel = $('#hve-tb-font');
      fontSel.value = single.style.fontFamily && FONT_OPTIONS.some(f => f.value === single.style.fontFamily)
        ? single.style.fontFamily : '';
      const sizeSel = $('#hve-tb-size');
      const px = Math.round(parseFloat(cs.fontSize));
      sizeSel.value = SIZE_OPTIONS.includes(px) ? px + 'px'
        : (SIZE_OPTIONS.reduce((a, b) => Math.abs(b - px) < Math.abs(a - px) ? b : a, SIZE_OPTIONS[0]) + 'px');
      const headSel = $('#hve-tb-heading');
      headSel.value = HEADING_OPTIONS.some(h => h.value === single.tagName) ? single.tagName : 'P';

      const st = $('#hve-swatch-text'), sb = $('#hve-swatch-bg');
      if (st) st.style.background = rgbToHex(cs.color);
      if (sb) {
        const bg = cs.backgroundColor;
        sb.style.background = bg === 'rgba(0, 0, 0, 0)' ? 'transparent' : rgbToHex(bg);
      }
    } else {
      ['bold', 'italic', 'underline', 'strike', 'align-left', 'align-center', 'align-right']
        .forEach(id => {
          const b = $('#hve-tb-' + id);
          if (b) b.classList.remove('hve-active');
        });
    }
    updateHistoryButtons();
    if (state.panels.pages && pagePanel) refreshPagePanel();
  }

  /* ---------------------------------------------------------
   * 16. Dialogs
   * ------------------------------------------------------- */

  function openDialog(config) {
    closeDropdown();
    const overlay = el('div', { 'class': 'hve-dialog-overlay', 'data-hve-ui': '' });
    const dlg = el('div', { 'class': 'hve-dialog', 'data-hve-ui': '' });
    dlg.appendChild(el('h3', {}, config.title));

    const inputs = {};
    (config.fields || []).forEach(f => {
      if (f.type === 'checkbox') {
        const row = el('label', { 'class': 'hve-check-row' });
        const cb = el('input', { type: 'checkbox' });
        cb.checked = !!f.value;
        row.appendChild(cb);
        row.appendChild(document.createTextNode(t(f.label)));
        dlg.appendChild(row);
        inputs[f.key] = cb;
        return;
      }
      dlg.appendChild(el('label', {}, t(f.label)));
      let inp;
      if (f.type === 'select') {
        inp = el('select');
        f.options.forEach(o => inp.add(new Option(t(o.label), o.value)));
        inp.value = f.value != null ? f.value : (f.options[0] && f.options[0].value);
      } else {
        inp = el('input', { type: f.type || 'text' });
        if (f.value != null) inp.value = f.value;
        if (f.placeholder) inp.placeholder = t(f.placeholder);
        if (f.min != null) inp.min = f.min;
        if (f.max != null) inp.max = f.max;
      }
      dlg.appendChild(inp);
      inputs[f.key] = inp;
    });

    if (config.custom) config.custom(dlg, inputs);

    const actions = el('div', { 'class': 'hve-dialog-actions' });
    const cancel = el('button', { 'class': 'hve-btn-cancel' }, t('Cancel'));
    const ok = el('button', { 'class': 'hve-btn-confirm' }, t(config.okLabel || 'OK'));
    actions.appendChild(cancel);
    actions.appendChild(ok);
    dlg.appendChild(actions);
    overlay.appendChild(dlg);
    uiRoot.appendChild(overlay);

    function close() { overlay.remove(); }
    function submit() {
      const values = {};
      for (const k in inputs) {
        const n = inputs[k];
        values[k] = n.type === 'checkbox' ? n.checked : n.value;
      }
      close();
      config.onOK(values);
    }
    cancel.addEventListener('click', close);
    ok.addEventListener('click', submit);
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });
    dlg.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); submit(); }
      if (e.key === 'Escape') { e.preventDefault(); close(); }
    });
    const first = dlg.querySelector('input,select');
    if (first) first.focus();
    return { close };
  }

  /* ---------------------------------------------------------
   * 17. Insert panel & element factories
   * ------------------------------------------------------- */

  const INSERT_ITEMS = [
    { id: 'container', icon: '▫', name: 'Container', desc: 'Wrapper box for other content' },
    { id: 'text', icon: '¶', name: 'Text Box', desc: 'A paragraph of text' },
    { id: 'heading', icon: 'H', name: 'Heading', desc: 'Heading text (H2)' },
    { id: 'table', icon: '▦', name: 'Table', desc: 'Rows & columns of data' },
    { id: 'image', icon: '🖼', name: 'Image', desc: 'From file or URL' },
    { id: 'button', icon: '⬭', name: 'Button', desc: 'Clickable button element' },
    { id: 'divider', icon: '─', name: 'Divider', desc: 'Horizontal rule' },
    { id: 'link', icon: '🔗', name: 'Link', desc: 'Hyperlink text' },
    { id: 'list', icon: '☰', name: 'List', desc: 'Bulleted list' },
    { id: 'quote', icon: '❝', name: 'Quote', desc: 'Blockquote' }
  ];

  function openInsertPanel(x, y) {
    closeDropdown();
    const panel = el('div', { 'class': 'hve-insert-panel', 'data-hve-ui': '' });
    panel.appendChild(el('div', { 'class': 'hve-ip-title' }, t('Insert element')));

    const modeRow = el('div', { 'class': 'hve-ip-mode' });
    const flowBtn = el('button', { 'class': 'hve-ip-mode-btn' + (state.insertMode === 'flow' ? ' active' : '') }, t('▤ Flow'));
    const floatBtn = el('button', { 'class': 'hve-ip-mode-btn' + (state.insertMode === 'float' ? ' active' : '') }, t('✦ Float'));
    flowBtn.addEventListener('click', () => {
      state.insertMode = 'flow';
      flowBtn.classList.add('active'); floatBtn.classList.remove('active');
    });
    floatBtn.addEventListener('click', () => {
      state.insertMode = 'float';
      floatBtn.classList.add('active'); flowBtn.classList.remove('active');
    });
    modeRow.appendChild(flowBtn);
    modeRow.appendChild(floatBtn);
    panel.appendChild(modeRow);

    INSERT_ITEMS.forEach(item => {
      const row = el('div', { 'class': 'hve-ip-item' });
      row.innerHTML = `<div class="hve-ip-icon">${item.icon}</div>
        <div class="hve-ip-text"><b></b><span></span></div>`;
      row.querySelector('b').textContent = t(item.name);
      row.querySelector('span').textContent = t(item.desc);
      row.addEventListener('click', () => {
        closeDropdown();
        insertNewItem(item.id);
      });
      panel.appendChild(row);
    });

    openMenuEl = panel;
    if (x != null && y != null) {
      uiRoot.appendChild(panel);
      panel.style.left = clamp(x, 8, window.innerWidth - panel.offsetWidth - 8) + 'px';
      panel.style.top = clamp(y, 66, window.innerHeight - panel.offsetHeight - 8) + 'px';
    } else {
      positionNear(panel, $('#hve-tb-insert'));
    }
  }

  function insertNewItem(id) {
    switch (id) {
      case 'container': insertElements([makeContainer()]); break;
      case 'text': insertElements([makeTextBox()]); break;
      case 'heading': insertElements([makeHeading()]); break;
      case 'table': openTableDialog(); break;
      case 'image': openImageDialog(); break;
      case 'button': insertElements([makeButton()]); break;
      case 'divider': insertElements([makeDivider()]); break;
      case 'link': openLinkDialog(); break;
      case 'list': insertElements([makeList()]); break;
      case 'quote': insertElements([makeQuote()]); break;
    }
  }

  function makeContainer() {
    return el('div', {
      style: 'min-height:120px;border:2px dashed #d8cec2;border-radius:12px;padding:16px;margin:12px 0;' +
        'display:flex;align-items:center;justify-content:center;color:#b3ada2;' +
        'font:500 13px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;'
    }, t('Container — drop or insert elements here'));
  }

  function makeTextBox() {
    return el('p', {
      style: 'margin:12px 0;line-height:1.7;color:#3d3d3a;' +
        'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;'
    }, t('Double-click to edit this text. Use the floating toolbar to change fonts, colors and alignment.'));
  }

  function makeHeading() {
    return el('h2', {
      style: 'margin:18px 0 10px;color:#141413;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;'
    }, t('Your Heading Here'));
  }

  function makeButton() {
    return el('button', {
      style: 'padding:12px 26px;border:none;border-radius:10px;background:linear-gradient(135deg,#cc785c,#a9583e);' +
        'color:#fff;font:600 15px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;cursor:pointer;margin:10px 0;'
    }, t('Click Me'));
  }

  function makeDivider() {
    return el('hr', { style: 'border:none;border-top:2px solid #e6dfd8;margin:24px 0;' });
  }

  function makeList() {
    const ul = el('ul', { style: 'margin:12px 0;padding-left:24px;line-height:1.9;color:#3d3d3a;' });
    ['First list item', 'Second list item', 'Third list item'].forEach(txt => {
      const li = el('li', {}, t(txt));
      ul.appendChild(li);
    });
    return ul;
  }

  function makeQuote() {
    return el('blockquote', {
      style: 'margin:16px 0;padding:10px 20px;border-left:4px solid #cc785c;background:#faf9f5;' +
        'border-radius:0 10px 10px 0;color:#6c6a64;font-style:italic;'
    }, t('Double-click to edit this quote.'));
  }

  function makeTable(rows, cols, header) {
    const table = el('table', {
      style: 'border-collapse:collapse;width:100%;margin:14px 0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;'
    });
    for (let r = 0; r < rows; r++) {
      const tr = el('tr', {});
      for (let c = 0; c < cols; c++) {
        const isHead = header && r === 0;
        const cell = el(isHead ? 'th' : 'td', {
          style: 'border:1px solid #d8cec2;padding:10px 14px;text-align:left;' +
            (isHead ? 'background:#f5f0e8;font-weight:600;color:#141413;' : 'color:#3d3d3a;')
        }, isHead ? t('Header {n}', { n: c + 1 }) : t('Cell'));
        tr.appendChild(cell);
      }
      table.appendChild(tr);
    }
    return table;
  }

  function makeImage(src, alt) {
    return el('img', {
      src: src, alt: alt ? t(alt) : t('Image'),
      style: 'max-width:100%;height:auto;border-radius:12px;margin:12px 0;display:block;'
    });
  }

  function openTableDialog() {
    openDialog({
      title: t('Insert Table'),
      fields: [
        { key: 'rows', label: t('Rows'), type: 'number', value: 3, min: 1, max: 50 },
        { key: 'cols', label: t('Columns'), type: 'number', value: 3, min: 1, max: 20 },
        { key: 'header', label: t('Include header row'), type: 'checkbox', value: true }
      ],
      okLabel: t('Insert'),
      onOK: (v) => {
        const tbl = makeTable(clamp(parseInt(v.rows) || 3, 1, 50), clamp(parseInt(v.cols) || 3, 1, 20), v.header);
        insertElements([tbl]);
      }
    });
  }

  function openImageDialog() {
    let fileData = null;
    openDialog({
      title: t('Insert Image'),
      fields: [
        { key: 'url', label: t('Image URL'), type: 'text', placeholder: t('https://… or leave empty if uploading a file') },
        { key: 'alt', label: t('Alt text (optional)'), type: 'text', placeholder: t('Describe the image') }
      ],
      okLabel: t('Insert'),
      custom: (dlg, inputs) => {
        const wrap = el('div', {});
        wrap.appendChild(el('label', {}, 'Or choose a file'));
        const file = el('input', { type: 'file', accept: 'image/*' });
        file.style.cssText = 'width:100%;padding:6px;border:1px dashed #d8cec2;border-radius:10px;margin-bottom:14px;box-sizing:border-box;font-size:13px;';
        file.addEventListener('change', () => {
          if (file.files && file.files[0]) {
            const reader = new FileReader();
            reader.onload = () => { fileData = reader.result; };
            reader.readAsDataURL(file.files[0]);
          }
        });
        wrap.appendChild(file);
        dlg.insertBefore(wrap, dlg.querySelector('.hve-dialog-actions'));
      },
      onOK: (v) => {
        if (fileData) {
          insertElements([makeImage(fileData, v.alt)]);
        } else if (v.url && v.url.trim()) {
          insertElements([makeImage(v.url.trim(), v.alt)]);
        } else {
          toast(t('Provide an image URL or choose a file'), 'error');
        }
      }
    });
  }

  function openLinkDialog() {
    openDialog({
      title: t('Insert Link'),
      fields: [
        { key: 'text', label: t('Link text'), type: 'text', value: t('Read more'), placeholder: t('Link text') },
        { key: 'href', label: 'URL', type: 'text', value: 'https://', placeholder: 'https://…' }
      ],
      okLabel: t('Insert'),
      onOK: (v) => {
        const a = el('a', {
          href: v.href || '#',
          style: 'color:#a9583e;text-decoration:underline;font-weight:500;'
        }, v.text || t('link'));
        insertElements([a]);
      }
    });
  }

  function insertElements(elements) {
    pushUndo();
    const float = state.insertMode === 'float';
    let anchor = state.selected[state.selected.length - 1];
    if (state.quickAddRef) anchor = null;

    elements.forEach(elm => {
      if (float) {
        elm.style.position = 'absolute';
        elm.setAttribute('data-hve-floating', '');
        const w = 320;
        elm.style.left = clamp(Math.round(window.scrollX + window.innerWidth / 2 - w / 2), 8, 10000) + 'px';
        elm.style.top = Math.round(window.scrollY + window.innerHeight * 0.3) + 'px';
        elm.style.zIndex = 5;
        document.body.insertBefore(elm, uiRoot);
      } else if (state.quickAddRef && state.quickAddRef.ref) {
        state.quickAddRef.container.insertBefore(elm, state.quickAddRef.ref);
      } else if (state.quickAddRef) {
        state.quickAddRef.container.appendChild(elm);
      } else if (anchor && anchor.isConnected) {
        anchor.insertAdjacentElement('afterend', elm);
      } else {
        document.body.insertBefore(elm, uiRoot);
      }
    });

    state.quickAddRef = null;
    if (elements.length) {
      setSelection(elements);
      elements[0].scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
    toast(t('Inserted — drag to reposition'), 'success');
  }

  /* ---------------------------------------------------------
   * 18. Context menu
   * ------------------------------------------------------- */

  function onContextMenu(e) {
    if (!state.editMode) return;
    if (isUI(e.target)) return;
    if (state.editingEl && state.editingEl.contains(e.target)) return; // native menu while editing text
    e.preventDefault();
    closeDropdown();

    // select the right-clicked element if not already selected
    const target = selectionTargetFrom(e.target);
    if (!target) return;
    if (!state.selected.includes(target)) setSelection([target]);

    const menu = el('div', { 'class': 'hve-context-menu', 'data-hve-ui': '' });
    const locked = state.selected.every(s => s.hasAttribute('data-hve-locked'));
    const multi = state.selected.length > 1;
    const groupEl = state.selected[0] && state.selected[0].hasAttribute('data-hve-group') ? state.selected[0] : null;
    const cell = e.target.closest('td,th');
    const table = e.target.closest('table');

    const addItem = (icon, label, shortcut, fn, danger) => {
      const item = el('div', { 'class': 'hve-cm-item' + (danger ? ' danger' : '') });
      item.innerHTML = `<span class="hve-cm-icon">${icon || ''}</span><span></span>` +
        (shortcut ? `<span class="hve-cm-shortcut">${shortcut}</span>` : '');
      item.children[1].textContent = label;
      item.addEventListener('click', () => { closeDropdown(); fn(); });
      menu.appendChild(item);
      return item;
    };
    const addSep = () => menu.appendChild(el('div', { 'class': 'hve-cm-divider' }));

    if (locked) {
      addItem('🔓', t('Unlock Element'), 'Ctrl+L', toggleLock);
      addItem('⬆', t('Select Parent'), 'Esc', () => selectParent());
      openMenu(menu, e);
      return;
    }

    addItem('✏️', t('Edit Text'), 'Dbl-click', () => enterTextEdit(target));
    addItem('⧉', t('Duplicate Element'), 'Ctrl+D', duplicateSelection);
    addSep();

    addItem('🎨', t('Copy Style'), 'Ctrl+Shift+C', copyStyle);
    addItem('🖌', t('Paste Style'), 'Ctrl+Shift+V', pasteStyle);
    addItem('🧹', t('Clear Style'), '', clearStyle);
    addSep();

    addItem('⬆', t('Bring Forward'), '', () => layerOp('forward'));
    addItem('⬇', t('Send Backward'), '', () => layerOp('backward'));
    addItem('⏫', t('Bring to Front'), '', () => layerOp('front'));
    addItem('⏬', t('Send to Back'), '', () => layerOp('back'));
    addSep();

    if (multi) {
      addItem('📦', t('Group'), 'Ctrl+G', groupSelection);
    } else if (groupEl) {
      addItem('📦', t('Ungroup'), 'Ctrl+Shift+G', ungroupSelection);
    } else {
      addItem('📦', t('Group'), 'Ctrl+G', () => toast(t('Select multiple elements first (Ctrl+click)'), 'error'));
    }
    addItem('🔒', t('Lock Element'), 'Ctrl+L', toggleLock);
    addItem('⬆', t('Select Parent'), 'Esc', () => selectParent());

    if (cell && table) {
      addSep();
      addItem('↕', t('Insert Row Above'), '', () => tableRowOp(table, cell, 'row-above'));
      addItem('↕', t('Insert Row Below'), '', () => tableRowOp(table, cell, 'row-below'));
      addItem('↔', t('Insert Column Left'), '', () => tableColOp(table, cell, 'col-left'));
      addItem('↔', t('Insert Column Right'), '', () => tableColOp(table, cell, 'col-right'));
      addItem('✂', t('Delete Current Row'), '', () => tableRowOp(table, cell, 'row-del'));
      addItem('✂', t('Delete Current Column'), '', () => tableColOp(table, cell, 'col-del'));
      addItem('🎨', t('Toggle Table Style'), '', () => toggleTableStripes(table));
      addItem('▦', t('Select Entire Table'), '', () => setSelection([table]));
    }

    addSep();
    addItem('🗑', t('Delete'), 'Del', deleteSelection, true);

    openMenu(menu, e);
  }

  function openMenu(menu, e) {
    openMenuEl = menu;
    uiRoot.appendChild(menu);
    const mw = menu.offsetWidth, mh = menu.offsetHeight;
    let left = e.clientX, top = e.clientY;
    if (left + mw > window.innerWidth - 8) left = window.innerWidth - mw - 8;
    if (top + mh > window.innerHeight - 8) top = window.innerHeight - mh - 8;
    menu.style.left = Math.max(8, left) + 'px';
    menu.style.top = Math.max(8, top) + 'px';
  }

  /* ---- table operations ---- */

  function cellStyleFor(tag) {
    return 'border:1px solid #d8cec2;padding:10px 14px;text-align:left;' +
      (tag === 'th' ? 'background:#f5f0e8;font-weight:600;' : '');
  }

  function tableRowOp(table, cell, op) {
    pushUndo();
    const row = cell.parentElement;
    const idx = row.rowIndex;
    if (op === 'row-above' || op === 'row-below') {
      const cols = row.children.length;
      const tr = el('tr', {});
      for (let i = 0; i < cols; i++) {
        const td = el(row.firstElementChild.tagName === 'TH' && op === 'row-below' ? 'td' : 'td',
          { style: cellStyleFor('td') }, t('Cell'));
        tr.appendChild(td);
      }
      if (op === 'row-above') row.parentElement.insertBefore(tr, row);
      else row.insertAdjacentElement('afterend', tr);
    } else if (op === 'row-del') {
      if (table.rows.length <= 1) { toast(t('Cannot delete the last row'), 'error'); return; }
      row.remove();
    }
    updateToolbarState();
  }

  function tableColOp(table, cell, op) {
    pushUndo();
    const colIdx = cell.cellIndex;
    const rows = Array.from(table.rows);
    if (op === 'col-left' || op === 'col-right') {
      rows.forEach(r => {
        const ref = r.children[colIdx];
        const td = el(ref.tagName === 'TH' ? 'th' : 'td', { style: cellStyleFor(ref.tagName.toLowerCase()) },
          ref.tagName === 'TH' ? t('Header') : t('Cell'));
        if (op === 'col-left') r.insertBefore(td, ref);
        else ref.insertAdjacentElement('afterend', td);
      });
    } else if (op === 'col-del') {
      if (rows[0].children.length <= 1) { toast(t('Cannot delete the last column'), 'error'); return; }
      rows.forEach(r => { if (r.children[colIdx]) r.children[colIdx].remove(); });
    }
    updateToolbarState();
  }

  function toggleTableStripes(table) {
    pushUndo();
    const striped = table.getAttribute('data-striped') === 'on';
    Array.from(table.rows).forEach((r, i) => {
      if (i === 0 && r.firstElementChild.tagName === 'TH') return;
      Array.from(r.children).forEach(c => {
        if (striped) c.style.background = '';
        else if (i % 2 === 0) c.style.background = '#faf9f5';
      });
    });
    table.setAttribute('data-striped', striped ? 'off' : 'on');
    toast(striped ? t('Stripes removed') : t('Striped style applied'), 'info');
  }

  /* ---------------------------------------------------------
   * 19. Multi-select toast, grouping, parent selection
   * ------------------------------------------------------- */

  function showMultiToast() {
    if (!multiToast) return;
    multiToast.style.display = 'flex';
    multiToast.innerHTML = `
      <div class="hve-multi-info"><span class="hve-multi-dot"></span>
        <span><b></b> ${t('elements selected')}</span></div>
      <div class="hve-multi-actions">
        <button data-ma="group">📦 ${t('Group')}</button>
        <button data-ma="duplicate">⧉ ${t('Duplicate')}</button>
        <button data-ma="delete" class="danger">🗑 ${t('Delete')}</button>
      </div>
      <div class="hve-multi-hint">${t('Shift+click to toggle · Ctrl+click to add')}</div>`;
    multiToast.querySelector('b').textContent = state.selected.length;
    multiToast.querySelectorAll('[data-ma]').forEach(b => {
      b.addEventListener('click', () => {
        const a = b.dataset.ma;
        if (a === 'group') groupSelection();
        else if (a === 'duplicate') duplicateSelection();
        else if (a === 'delete') deleteSelection();
      });
    });
  }

  function hideMultiToast() {
    if (multiToast) multiToast.style.display = 'none';
  }

  function groupSelection() {
    if (state.selected.length < 2) {
      toast(t('Select at least 2 elements to group (Ctrl+click)'), 'error');
      return;
    }
    const parent = state.selected[0].parentElement;
    if (!state.selected.every(s => s.parentElement === parent)) {
      toast(t('Grouped elements must share the same parent'), 'error');
      return;
    }
    pushUndo();
    const ordered = Array.from(parent.children).filter(c => state.selected.includes(c));
    const group = el('div', {
      'data-hve-group': '',
      style: 'position:relative;display:flow-root;padding:8px;margin:8px 0;border-radius:10px;'
    });
    ordered[0].parentElement.insertBefore(group, ordered[0]);
    ordered.forEach(s => group.appendChild(s));
    setSelection([group]);
    toast(t('Grouped — drag to move together'), 'success');
  }

  function ungroupSelection() {
    const group = state.selected.find(s => s.hasAttribute('data-hve-group'));
    if (!group) {
      toast(t('Select a group first (teal dashed outline)'), 'error');
      return;
    }
    pushUndo();
    const parent = group.parentElement;
    const children = Array.from(group.children);
    children.forEach(c => parent.insertBefore(c, group));
    group.remove();
    setSelection(children);
    toast(t('Ungrouped'), 'info');
  }

  function selectParent() {
    const cur = state.selected[state.selected.length - 1];
    if (!cur) return;
    let p = cur.parentElement;
    while (p && p !== document.body && (isUI(p) || !isSelectable(p))) p = p.parentElement;
    if (!p || p === document.body) { clearSelection(); return; }
    setSelection([p]);
  }

  /* ---------------------------------------------------------
   * 20. Marquee multi-select
   * ------------------------------------------------------- */

  function armMarquee(e) {
    const startX = e.clientX, startY = e.clientY;
    let active = false;

    function onMove(ev) {
      if (!active && Math.hypot(ev.clientX - startX, ev.clientY - startY) > 6) {
        active = true;
        marqueeEl.style.display = 'block';
        document.body.style.userSelect = 'none';
      }
      if (!active) return;
      const x = Math.min(startX, ev.clientX), y = Math.min(startY, ev.clientY);
      const w = Math.abs(ev.clientX - startX), h = Math.abs(ev.clientY - startY);
      marqueeEl.style.left = x + 'px';
      marqueeEl.style.top = y + 'px';
      marqueeEl.style.width = w + 'px';
      marqueeEl.style.height = h + 'px';
    }

    function onUp() {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.userSelect = '';
      const r = active ? marqueeEl.getBoundingClientRect() : null; // capture BEFORE hiding
      marqueeEl.style.display = 'none';
      if (!active) { clearSelection(); return; } // simple click on background
      const hits = marqueeHits(r);
      if (hits.length) setSelection(hits);
      else clearSelection();
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  /*
   * Box-select: the marquee selects siblings inside the container the box is
   * drawn over (element at the box centre provides the context). If that level
   * yields no hits, climb to the parent level until elements are found.
   */
  function marqueeHits(r) {
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const under = document.elementFromPoint(cx, cy);
    const target = under ? selectionTargetFrom(under) : null;
    let container = target && target.parentElement && !isUI(target.parentElement)
      ? target.parentElement : document.body;
    if (container === document.documentElement) container = document.body;

    const hitsAt = (parent) => {
      const candidates = parent === document.body
        ? topLevelElements()
        : Array.from(parent.children).filter(c => c.nodeType === 1 && !isUI(c));
      return candidates.filter(cd => {
        if (cd.hasAttribute('data-hve-locked')) return false;
        if (cd.tagName === 'SCRIPT' || cd.tagName === 'STYLE') return false;
        const tr = cd.getBoundingClientRect();
        return tr.left < r.right && tr.right > r.left && tr.top < r.bottom && tr.bottom > r.top;
      });
    };

    let hits = hitsAt(container);
    while (!hits.length && container !== document.body) {
      container = container.parentElement || document.body;
      if (isUI(container) || container === document.documentElement) container = document.body;
      hits = hitsAt(container);
    }
    return hits;
  }

  function topLevelElements() {
    return Array.from(document.body.children).filter(n =>
      n.nodeType === 1 && n !== uiRoot && !isUI(n) && n.tagName !== 'SCRIPT' && n.tagName !== 'STYLE');
  }

  /* ---------------------------------------------------------
   * 21. Side panels (page sorter / chart typography / pdf)
   * ------------------------------------------------------- */

  let pagesPanelEl = null, chartPanelEl = null, pdfPanelEl = null;

  function togglePanel(name) {
    state.panels[name] = !state.panels[name];
    if (name !== 'pages') state.panels.pages = false;
    if (name !== 'chart') state.panels.chart = false;
    if (name !== 'pdf') state.panels.pdf = false;
    renderPanels();
  }

  function closeAllPanels(silent) {
    state.panels.pages = state.panels.chart = state.panels.pdf = false;
    renderPanels();
    if (!silent) { /* noop */ }
  }

  function renderPanels() {
    const tbPages = $('#hve-tb-pages'), tbChart = $('#hve-tb-chart');
    if (tbPages) tbPages.classList.toggle('hve-active', state.panels.pages);
    if (tbChart) tbChart.classList.toggle('hve-active', state.panels.chart);

    if (pagesPanelEl) { pagesPanelEl.remove(); pagesPanelEl = null; }
    if (chartPanelEl) { chartPanelEl.remove(); chartPanelEl = null; }
    if (pdfPanelEl) { pdfPanelEl.remove(); pdfPanelEl = null; }
    removePdfBreakPreview();

    if (state.panels.pages) pagesPanelEl = buildPagePanel();
    if (state.panels.chart) chartPanelEl = buildChartPanel();
    if (state.panels.pdf) pdfPanelEl = buildPdfPanel();
    if (pagesPanelEl) uiRoot.appendChild(pagesPanelEl);
    if (chartPanelEl) uiRoot.appendChild(chartPanelEl);
    if (pdfPanelEl) uiRoot.appendChild(pdfPanelEl);
    if (pagesPanelEl) refreshPagePanel(); // list must be built after the panel is connected
  }

  /* ---- page sorter ---- */

  let pagePanel = null;

  function buildPagePanel() {
    const panel = el('div', { 'class': 'hve-side-panel', 'data-hve-ui': '', style: 'width:340px' });
    panel.innerHTML = `
      <div class="hve-sp-header">
        <span class="hve-sp-title">${t('Page Sorter')}</span>
        <span class="hve-sp-count" id="hve-ps-count"></span>
        <button class="hve-sp-close" title="${t('Close')}">✕</button>
      </div>
      <div class="hve-sp-body" id="hve-ps-list"></div>`;
    panel.querySelector('.hve-sp-close').addEventListener('click', () => togglePanel('pages'));
    pagePanel = panel;
    refreshPagePanel();
    return panel;
  }

  function pageName(block) {
    const h = block.matches('h1,h2,h3,h4,h5,h6') ? block : block.querySelector('h1,h2,h3,h4,h5,h6');
    if (h && h.textContent.trim()) return h.textContent.trim().slice(0, 42);
    const txt = block.textContent.trim().replace(/\s+/g, ' ');
    if (txt) return txt.slice(0, 42);
    return '<' + block.tagName.toLowerCase() + '>';
  }

  function refreshPagePanel() {
    if (!pagePanel || !pagePanel.isConnected) return;
    const list = $('#hve-ps-list', pagePanel);
    const count = $('#hve-ps-count', pagePanel);
    if (!list) return;
    const els = topLevelElements();
    list.innerHTML = '';
    if (count) count.textContent = t('{n} blocks', { n: els.length });
    els.forEach((blk, i) => {
      const item = el('div', { 'class': 'hve-ps-item' + (state.selected.includes(blk) ? ' active' : '') });
      item.innerHTML = `
        <span class="hve-ps-num"></span>
        <span class="hve-ps-name"></span>
        <span class="hve-ps-actions">
          <button class="hve-ps-btn" data-op="up" title="${t('Move up')}">↑</button>
          <button class="hve-ps-btn" data-op="down" title="${t('Move down')}">↓</button>
          <button class="hve-ps-btn" data-op="del" title="${t('Delete')}">🗑</button>
        </span>`;
      item.querySelector('.hve-ps-num').textContent = i + 1;
      item.querySelector('.hve-ps-name').textContent = pageName(blk);
      item.addEventListener('click', (e) => {
        if (e.target.closest('.hve-ps-btn')) return;
        setSelection([blk]);
        blk.scrollIntoView({ block: 'start', behavior: 'smooth' });
        refreshPagePanel();
      });
      item.querySelectorAll('.hve-ps-btn').forEach(b => {
        b.addEventListener('click', () => {
          const op = b.dataset.op;
          if (op === 'up' || op === 'down') {
            pushUndo();
            if (op === 'up' && blk.previousElementSibling && blk.previousElementSibling !== uiRoot) {
              blk.parentElement.insertBefore(blk, blk.previousElementSibling);
            } else if (op === 'down' && blk.nextElementSibling && !isUI(blk.nextElementSibling)) {
              blk.parentElement.insertBefore(blk, blk.nextElementSibling.nextElementSibling);
            }
          } else if (op === 'del') {
            pushUndo();
            blk.remove();
            if (state.selected.includes(blk)) clearSelection();
          }
          refreshPagePanel();
        });
      });
      list.appendChild(item);
    });
    if (!els.length) list.appendChild(el('div', { 'class': 'hve-ps-empty' }, t('No page blocks found.')));
  }

  /* ---- chart typography panel ---- */

  const CHART_TEMPLATES = [
    {
      id: 'datacard', icon: '🔢', name: 'Data Card',
      html: `<div style="display:inline-block;min-width:240px;padding:24px 32px;background:#faf9f5;border:1px solid #e6dfd8;border-radius:16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
        <div style="font-size:44px;font-weight:800;color:#141413;letter-spacing:-1px;">128,400</div>
        <div style="font-size:14px;color:#6c6a64;margin-top:4px;">Monthly active users</div>
        <div style="font-size:13px;color:#10b981;font-weight:600;margin-top:10px;">▲ 12.5% vs last month</div>
      </div>`
    },
    {
      id: 'metric', icon: '📊', name: 'Metric Row',
      html: `<div style="max-width:480px;padding:16px 20px;background:#faf9f5;border:1px solid #e6dfd8;border-radius:12px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
        <div style="display:flex;justify-content:space-between;font-size:13px;color:#3d3d3a;margin-bottom:8px;">
          <span style="font-weight:600;">Conversion rate</span><span style="font-weight:700;color:#cc785c;">68%</span>
        </div>
        <div style="height:10px;background:#efe9de;border-radius:6px;overflow:hidden;">
          <div style="width:68%;height:100%;background:linear-gradient(90deg,#cc785c,#a9583e);border-radius:6px;"></div>
        </div>
      </div>`
    },
    {
      id: 'compare', icon: '⚖️', name: 'Comparison',
      html: `<div style="display:inline-flex;align-items:center;gap:20px;padding:20px 28px;background:#faf9f5;border:1px solid #e6dfd8;border-radius:16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
        <div style="text-align:center;">
          <div style="font-size:32px;font-weight:800;color:#cc785c;">A · 84%</div>
          <div style="font-size:12px;color:#8e8b82;margin-top:3px;">Variant A</div>
        </div>
        <div style="font-size:13px;font-weight:700;color:#b3ada2;background:#efe9de;padding:6px 12px;border-radius:999px;">VS</div>
        <div style="text-align:center;">
          <div style="font-size:32px;font-weight:800;color:#3aa08b;">B · 91%</div>
          <div style="font-size:12px;color:#8e8b82;margin-top:3px;">Variant B</div>
        </div>
      </div>`
    },
    {
      id: 'tablehead', icon: '▦', name: 'Table Heading',
      html: `<div style="max-width:520px;padding:18px 24px;border-bottom:3px solid #cc785c;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
        <div style="font-size:22px;font-weight:700;color:#141413;">Q3 Performance Report</div>
        <div style="display:flex;justify-content:space-between;margin-top:6px;">
          <span style="font-size:13px;color:#6c6a64;">Revenue · Retention · Growth</span>
          <span style="font-size:12px;color:#8e8b82;">Updated Sep 30</span>
        </div>
      </div>`
    },
    {
      id: 'legend', icon: '🎨', name: 'Legend',
      html: `<div style="display:inline-block;padding:16px 22px;background:#faf9f5;border:1px solid #e6dfd8;border-radius:12px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:14px;">
        <div style="display:flex;align-items:center;gap:10px;padding:5px 0;"><span style="width:12px;height:12px;border-radius:50%;background:#cc785c;display:inline-block;"></span><span style="color:#3d3d3a;min-width:110px;">Desktop</span><span style="font-weight:700;color:#141413;">54%</span></div>
        <div style="display:flex;align-items:center;gap:10px;padding:5px 0;"><span style="width:12px;height:12px;border-radius:50%;background:#3aa08b;display:inline-block;"></span><span style="color:#3d3d3a;min-width:110px;">Mobile</span><span style="font-weight:700;color:#141413;">39%</span></div>
        <div style="display:flex;align-items:center;gap:10px;padding:5px 0;"><span style="width:12px;height:12px;border-radius:50%;background:#f59e0b;display:inline-block;"></span><span style="color:#3d3d3a;min-width:110px;">Tablet</span><span style="font-weight:700;color:#141413;">7%</span></div>
      </div>`
    },
    {
      id: 'annotation', icon: '💬', name: 'Annotation',
      html: `<div style="display:inline-flex;align-items:flex-start;gap:10px;max-width:420px;padding:14px 18px;background:#fff8f0;border-left:4px solid #cc785c;border-radius:0 10px 10px 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
        <span style="font-size:20px;line-height:1;">↘</span>
        <div><div style="font-size:13px;font-weight:700;color:#a9583e;">Key insight</div>
        <div style="font-size:13px;color:#6c6a64;margin-top:3px;line-height:1.6;">Peak traffic occurs between 8–10 PM; schedule deploys outside this window.</div></div>
      </div>`
    },
    {
      id: 'badge', icon: '🏷️', name: 'Badge',
      html: `<div style="display:inline-flex;gap:10px;padding:12px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:12px;font-weight:600;">
        <span style="padding:6px 14px;border-radius:999px;background:#dcfce7;color:#059669;">● Active</span>
        <span style="padding:6px 14px;border-radius:999px;background:#fef3c7;color:#b45309;">● Pending</span>
        <span style="padding:6px 14px;border-radius:999px;background:#fee2e2;color:#b91c1c;">● Failed</span>
        <span style="padding:6px 14px;border-radius:999px;background:#e0e7ff;color:#4338ca;">● Draft</span>
      </div>`
    },
    {
      id: 'kpi', icon: '🎚️', name: 'KPI Grid',
      html: `<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;max-width:440px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
        <div style="padding:18px 20px;background:#faf9f5;border:1px solid #e6dfd8;border-radius:12px;"><div style="font-size:26px;font-weight:800;color:#141413;">$42.1k</div><div style="font-size:12px;color:#8e8b82;margin-top:2px;">Revenue</div></div>
        <div style="padding:18px 20px;background:#faf9f5;border:1px solid #e6dfd8;border-radius:12px;"><div style="font-size:26px;font-weight:800;color:#141413;">8,204</div><div style="font-size:12px;color:#8e8b82;margin-top:2px;">Orders</div></div>
        <div style="padding:18px 20px;background:#faf9f5;border:1px solid #e6dfd8;border-radius:12px;"><div style="font-size:26px;font-weight:800;color:#141413;">3.8%</div><div style="font-size:12px;color:#8e8b82;margin-top:2px;">Churn</div></div>
        <div style="padding:18px 20px;background:#faf9f5;border:1px solid #e6dfd8;border-radius:12px;"><div style="font-size:26px;font-weight:800;color:#141413;">61</div><div style="font-size:12px;color:#8e8b82;margin-top:2px;">NPS</div></div>
      </div>`
    }
  ];

  function buildChartPanel() {
    const panel = el('div', { 'class': 'hve-side-panel', 'data-hve-ui': '' });
    panel.innerHTML = `
      <div class="hve-sp-header">
        <span class="hve-sp-title">${t('Chart Typography')}</span>
        <button class="hve-sp-close" title="${t('Close')}">✕</button>
      </div>
      <div class="hve-sp-body">
        <div class="hve-chart-section-title">${t('Templates')}</div>
        <div class="hve-chart-grid" id="hve-chart-grid"></div>
        <div class="hve-chart-section-title" style="margin-top:14px;">${t('Fine-tune selected')}</div>
        <div class="hve-chart-ctrl"><label>${t('Font size')}</label><input type="range" id="hve-ct-size" min="8" max="48" value="14"><span class="hve-ctrl-val" id="hve-ct-size-v">14px</span></div>
        <div class="hve-chart-ctrl"><label>${t('Font weight')}</label><select id="hve-ct-weight">
          <option value="300">${t('300 Light')}</option><option value="400">${t('400 Regular')}</option>
          <option value="500">${t('500 Medium')}</option><option value="600">${t('600 Semibold')}</option>
          <option value="700" selected>${t('700 Bold')}</option><option value="800">${t('800 Extrabold')}</option>
        </select></div>
        <div class="hve-chart-ctrl"><label>${t('Letter spacing')}</label><input type="range" id="hve-ct-ls" min="0" max="8" step="0.5" value="0"><span class="hve-ctrl-val" id="hve-ct-ls-v">0px</span></div>
        <div class="hve-chart-ctrl"><label>${t('Line height')}</label><select id="hve-ct-lh">
          <option value="1.2">1.2</option><option value="1.4">1.4</option><option value="1.6">1.6</option>
          <option value="1.8">1.8</option><option value="2">2.0</option>
        </select></div>
        <div class="hve-chart-align-row">
          <button data-align="left">⯇</button><button data-align="center">≡</button><button data-align="right">⯈</button>
        </div>
      </div>`;
    panel.querySelector('.hve-sp-close').addEventListener('click', () => togglePanel('chart'));

    const grid = $('#hve-chart-grid', panel);
    CHART_TEMPLATES.forEach(tp => {
      const tile = el('button', { 'class': 'hve-chart-tile', title: t('Insert {name}', { name: t(tp.name) }) });
      tile.innerHTML = `<span class="hve-ct-icon">${tp.icon}</span><span class="hve-ct-name"></span>`;
      tile.querySelector('.hve-ct-name').textContent = t(tp.name);
      tile.addEventListener('click', () => {
        const wrap = document.createElement('div');
        wrap.innerHTML = tp.html;
        const node = wrap.firstElementChild;
        insertElements([node]);
      });
      grid.appendChild(tile);
    });

    const applyToSelected = (prop, val, key) => {
      if (!state.selected.length) { toast(t('Select an element first'), 'error'); return; }
      pushUndo(key);
      forEachSelected(s => { s.style[prop] = val; });
    };

    const sizeR = $('#hve-ct-size', panel), sizeV = $('#hve-ct-size-v', panel);
    sizeR.addEventListener('input', () => {
      sizeV.textContent = sizeR.value + 'px';
      applyToSelected('fontSize', sizeR.value + 'px', 'ct-size');
    });
    const lsR = $('#hve-ct-ls', panel), lsV = $('#hve-ct-ls-v', panel);
    lsR.addEventListener('input', () => {
      lsV.textContent = lsR.value + 'px';
      applyToSelected('letterSpacing', lsR.value + 'px', 'ct-ls');
    });
    $('#hve-ct-weight', panel).addEventListener('change', (e) => applyToSelected('fontWeight', e.target.value));
    $('#hve-ct-lh', panel).addEventListener('change', (e) => applyToSelected('lineHeight', e.target.value));
    panel.querySelectorAll('[data-align]').forEach(b => {
      b.addEventListener('click', () => applyToSelected('textAlign', b.dataset.align));
    });

    return panel;
  }

  /* ---------------------------------------------------------
   * 22. PDF export
   * ------------------------------------------------------- */

  const PDF_SIZES = {
    a4: { label: 'A4 (210×297mm)', w: 210, h: 297 },
    a3: { label: 'A3 (297×420mm)', w: 297, h: 420 },
    a5: { label: 'A5 (148×210mm)', w: 148, h: 210 },
    letter: { label: 'Letter (8.5×11in)', w: 215.9, h: 279.4 },
    legal: { label: 'Legal (8.5×14in)', w: 215.9, h: 355.6 },
    custom: { label: 'Custom…', w: 210, h: 297 }
  };

  const pdfState = { size: 'a4', orient: 'portrait', margins: [10, 10, 10, 10], scale: 100, breaks: false, customW: 210, customH: 297 };

  function buildPdfPanel() {
    const panel = el('div', { 'class': 'hve-side-panel', 'data-hve-ui': '', style: 'width:280px' });
    panel.innerHTML = `
      <div class="hve-sp-header">
        <span class="hve-sp-title">${t('Export PDF')}</span>
        <button class="hve-sp-close" title="${t('Close')}">✕</button>
      </div>
      <div class="hve-sp-body">
        <div class="hve-pdf-row"><label>${t('Page size')}</label>
          <select id="hve-pdf-size">${Object.entries(PDF_SIZES).map(([k, v]) => `<option value="${k}">${t(v.label)}</option>`).join('')}</select>
        </div>
        <div class="hve-pdf-row" id="hve-pdf-custom-row" style="display:none"><label>${t('Custom size (mm)')}</label>
          <div class="hve-pdf-custom"><input type="number" id="hve-pdf-cw" value="210" min="50" max="600"><span>×</span><input type="number" id="hve-pdf-ch" value="297" min="50" max="900"></div>
        </div>
        <div class="hve-pdf-row"><label>${t('Orientation')}</label>
          <div class="hve-pdf-toggle">
            <button id="hve-pdf-portrait" class="active">${t('▯ Portrait')}</button>
            <button id="hve-pdf-landscape">${t('▭ Landscape')}</button>
          </div>
        </div>
        <div class="hve-pdf-row"><label>${t('Margins T / R / B / L (mm)')}</label>
          <div class="hve-pdf-margins">
            <input type="number" id="hve-pdf-mt" value="10" min="0" max="60">
            <input type="number" id="hve-pdf-mr" value="10" min="0" max="60">
            <input type="number" id="hve-pdf-mb" value="10" min="0" max="60">
            <input type="number" id="hve-pdf-ml" value="10" min="0" max="60">
          </div>
        </div>
        <div class="hve-pdf-row"><label>${t('Scale')} — <span id="hve-pdf-scale-v">100%</span></label>
          <input type="range" id="hve-pdf-scale" min="50" max="150" value="100" style="width:100%;accent-color:#cc785c">
        </div>
        <div class="hve-pdf-row hve-pdf-row-compact" style="display:flex;align-items:center;gap:6px;font-size:12px;color:#3d3d3a;">
          <input type="checkbox" id="hve-pdf-breaks" style="accent-color:#cc785c"><label for="hve-pdf-breaks" style="margin:0;cursor:pointer;">${t('Preview page breaks')}</label>
        </div>
        <div class="hve-pdf-divider"></div>
        <div class="hve-pdf-info" id="hve-pdf-info"></div>
        <div class="hve-pdf-actions">
          <button class="hve-pdf-btn-primary" id="hve-pdf-export">${t('⬇ Export PDF')}</button>
          <button class="hve-pdf-btn" id="hve-pdf-print">${t('🖨 Print / Save as PDF')}</button>
        </div>
      </div>`;
    panel.querySelector('.hve-sp-close').addEventListener('click', () => togglePanel('pdf'));

    const sizeSel = $('#hve-pdf-size', panel);
    sizeSel.addEventListener('change', () => {
      pdfState.size = sizeSel.value;
      $('#hve-pdf-custom-row', panel).style.display = sizeSel.value === 'custom' ? 'block' : 'none';
      updatePdfInfo();
    });
    $('#hve-pdf-portrait', panel).addEventListener('click', () => setOrient('portrait'));
    $('#hve-pdf-landscape', panel).addEventListener('click', () => setOrient('landscape'));
    ['mt', 'mr', 'mb', 'ml'].forEach((id, i) => {
      $('#hve-pdf-' + id, panel).addEventListener('input', (e) => {
        pdfState.margins[i] = clamp(parseFloat(e.target.value) || 0, 0, 60);
        updatePdfInfo();
      });
    });
    const scaleR = $('#hve-pdf-scale', panel);
    scaleR.addEventListener('input', () => {
      pdfState.scale = parseInt(scaleR.value);
      $('#hve-pdf-scale-v', panel).textContent = pdfState.scale + '%';
      updatePdfInfo();
    });
    $('#hve-pdf-cw', panel).addEventListener('input', (e) => { pdfState.customW = clamp(parseFloat(e.target.value) || 210, 50, 600); updatePdfInfo(); });
    $('#hve-pdf-ch', panel).addEventListener('input', (e) => { pdfState.customH = clamp(parseFloat(e.target.value) || 297, 50, 900); updatePdfInfo(); });
    $('#hve-pdf-breaks', panel).addEventListener('change', (e) => {
      pdfState.breaks = e.target.checked;
      renderPdfBreakPreview();
    });
    $('#hve-pdf-export', panel).addEventListener('click', exportPDF);
    $('#hve-pdf-print', panel).addEventListener('click', printDocument);

    function setOrient(o) {
      pdfState.orient = o;
      $('#hve-pdf-portrait', panel).classList.toggle('active', o === 'portrait');
      $('#hve-pdf-landscape', panel).classList.toggle('active', o === 'landscape');
      updatePdfInfo();
    }
    function updatePdfInfo() {
      const d = pdfDims();
      const bodyW = document.body.clientWidth;
      const pxPerMm = bodyW / d.cw;
      const pages = Math.max(1, Math.ceil((document.body.scrollHeight - pdfState.margins[0] * pxPerMm * 0) / (d.ch * pxPerMm)));
      $('#hve-pdf-info', panel).textContent =
        d.w + '×' + d.h + 'mm · ' + t(pdfState.orient) + ' · ' + t('{n} page(s)', { n: pages });
      renderPdfBreakPreview();
    }
    updatePdfInfo();
    return panel;
  }

  function pdfDims() {
    let { w, h } = PDF_SIZES[pdfState.size] || PDF_SIZES.a4;
    if (pdfState.size === 'custom') { w = pdfState.customW; h = pdfState.customH; }
    if (pdfState.orient === 'landscape') { const tw = w; w = h; h = tw; }
    const [mt, mr, mb, ml] = pdfState.margins;
    return { w, h, cw: Math.max(10, w - ml - mr), ch: Math.max(10, h - mt - mb) };
  }

  let pdfBreakOverlay = null;

  function renderPdfBreakPreview() {
    removePdfBreakPreview();
    if (!pdfState.breaks || !state.panels.pdf) return;
    const d = pdfDims();
    const pxPerMm = document.body.clientWidth / d.cw;
    const pageH = d.ch * pxPerMm;
    pdfBreakOverlay = el('div', { 'data-hve-ui': '', style: 'position:absolute;top:0;left:0;right:0;pointer-events:none;z-index:999;' });
    const total = document.body.scrollHeight;
    for (let y = pageH, p = 2; y < total - 10; y += pageH, p++) {
      const line = el('div', { 'class': 'hve-pdf-breakline' });
      line.style.top = y + 'px';
      line.innerHTML = `<span class="hve-pb-label">${t('Page {n} starts here', { n: p })}</span>`;
      pdfBreakOverlay.appendChild(line);
    }
    document.body.appendChild(pdfBreakOverlay);
  }

  function removePdfBreakPreview() {
    if (pdfBreakOverlay) { pdfBreakOverlay.remove(); pdfBreakOverlay = null; }
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const existing = document.head.querySelector('script[data-hve-src="' + src + '"]');
      if (existing) { existing.dataset.loaded === '1' ? resolve() : existing.addEventListener('load', resolve); return; }
      const s = document.createElement('script');
      s.src = src;
      s.setAttribute('data-hve-ui', '');
      s.setAttribute('data-hve-src', src);
      s.addEventListener('load', () => { s.dataset.loaded = '1'; resolve(); });
      s.addEventListener('error', () => reject(new Error('Failed to load ' + src)));
      document.head.appendChild(s);
    });
  }

  async function exportPDF() {
    const btn = $('#hve-pdf-export');
    try {
      btn.disabled = true;
      btn.textContent = t('Generating…');
      toast(t('Generating PDF…'), 'info');
      await loadScript('https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js');
      await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js');
    } catch (err) {
      btn.disabled = false;
      btn.textContent = t('⬇ Export PDF');
      toast(t('PDF libraries need network — using print instead'), 'error');
      printDocument();
      return;
    }

    const d = pdfDims();
    const [mt, mr, mb, ml] = pdfState.margins;
    const scale = pdfState.scale / 100;

    const prevDisplay = uiRoot.style.display;
    const prevPad = document.documentElement.classList.contains('hve-on');
    try {
      uiRoot.style.display = 'none';
      if (prevPad) document.documentElement.classList.remove('hve-on');
      document.body.style.paddingTop = '';

      const canvas = await html2canvas(document.body, {
        scale: 2,
        backgroundColor: '#ffffff',
        useCORS: true,
        logging: false,
        windowWidth: document.documentElement.clientWidth
      });

      const bodyW = document.body.clientWidth;
      const pxPerMm = (bodyW / d.cw) / scale;
      const sliceH = d.ch * pxPerMm;          // css px per page
      const sliceH2 = Math.round(sliceH * 2); // canvas px per page
      const total = Math.max(1, Math.ceil(canvas.height / sliceH2));

      const { jsPDF } = window.jspdf;
      const pdf = new jsPDF({
        unit: 'mm',
        format: [d.w, d.h],
        orientation: pdfState.orient === 'landscape' ? 'landscape' : 'portrait'
      });

      for (let i = 0; i < total; i++) {
        if (i > 0) pdf.addPage([d.w, d.h], pdfState.orient);
        const y = i * sliceH2;
        const h = Math.min(sliceH2, canvas.height - y);
        if (h <= 0) break;
        const slice = document.createElement('canvas');
        slice.width = canvas.width;
        slice.height = h;
        const ctx = slice.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, slice.width, slice.height);
        ctx.drawImage(canvas, 0, y, canvas.width, h, 0, 0, canvas.width, h);
        const img = slice.toDataURL('image/jpeg', 0.92);
        // slice content width maps to content width in mm
        const imgWmm = d.cw * scale;
        const imgHmm = (h / 2) / pxPerMm;
        pdf.addImage(img, 'JPEG', ml, mt, imgWmm, Math.min(imgHmm, d.ch));
      }

      const name = (state.fileName || 'untitled').replace(/\.html?$/i, '') + '.pdf';
      pdf.save(name);
      toast(t('PDF exported ✓'), 'success');
    } catch (err) {
      console.error('[HVE PDF]', err);
      toast(t('PDF export failed: {msg}', { msg: err.message }), 'error');
    } finally {
      uiRoot.style.display = prevDisplay;
      if (prevPad) document.documentElement.classList.add('hve-on');
      btn.disabled = false;
      btn.textContent = t('⬇ Export PDF');
    }
  }

  function printDocument() {
    const d = pdfDims();
    const [mt, mr, mb, ml] = pdfState.margins;
    const style = document.createElement('style');
    style.setAttribute('data-hve-ui', '');
    style.id = 'hve-print-style';
    style.textContent =
      '@page { size: ' + d.w + 'mm ' + d.h + 'mm; margin: ' + mt + 'mm ' + mr + 'mm ' + mb + 'mm ' + ml + 'mm; }' +
      '@media print { body { padding-top: 0 !important; } }';
    document.head.appendChild(style);
    const cleanup = () => { style.remove(); window.removeEventListener('afterprint', cleanup); };
    window.addEventListener('afterprint', cleanup);
    setTimeout(() => window.print(), 60);
  }

  /* ---------------------------------------------------------
   * 23. Save / open
   * ------------------------------------------------------- */

  function serializeDocument() {
    const clone = document.documentElement.cloneNode(true);
    clone.querySelectorAll('[data-hve-ui]').forEach(n => n.remove());
    stripMarks(clone, false);
    clone.classList.remove('hve-on');
    clone.querySelectorAll('[data-striped]').forEach(n => n.removeAttribute('data-striped'));
    return '<!DOCTYPE html>\n' + clone.outerHTML;
  }

  function saveAs() {
    if (state.editingEl) exitTextEdit();
    clearSelection();
    const html = serializeDocument();
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = state.fileName || 'untitled.html';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    toast(t('Saved {name}', { name: state.fileName || 'untitled.html' }), 'success');
  }

  function openFilePicker() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.html,.htm';
    input.style.display = 'none';
    input.addEventListener('change', async () => {
      const file = input.files && input.files[0];
      input.remove();
      if (!file) return;
      try {
        const text = await file.text();
        loadDocument(text, file.name);
      } catch (err) {
        toast(t('Could not read file: {msg}', { msg: err.message }), 'error');
      }
    });
    document.body.appendChild(input);
    input.click();
  }

  function loadDocument(html, name) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    if (!doc.body) { toast(t('Invalid HTML file'), 'error'); return; }

    if (state.editingEl) exitTextEdit();
    clearSelection();
    closeAllPanels(true);

    // adopt body content
    Array.from(document.body.childNodes).forEach(n => { if (n !== uiRoot) n.remove(); });
    Array.from(doc.body.childNodes).forEach(n => {
      document.body.insertBefore(document.importNode(n, true), uiRoot);
    });
    // adopt body attributes (style/class/id) when present
    if (doc.body.getAttribute('style')) document.body.setAttribute('style', doc.body.getAttribute('style'));
    if (doc.body.getAttribute('class')) document.body.setAttribute('class', doc.body.getAttribute('class'));

    // adopt author styles from the file's head
    $$('style[data-hve-user],link[data-hve-user]').forEach(n => n.remove());
    Array.from(doc.head.querySelectorAll('style,link[rel="stylesheet"]')).forEach(n => {
      const copy = document.importNode(n, true);
      copy.setAttribute('data-hve-user', '');
      document.head.appendChild(copy);
    });
    const title = doc.querySelector('title');
    if (title) document.title = title.textContent;

    // a fresh document: re-apply the active language (pristine content only)
    applyHeadLang();
    applyDocumentLang();

    state.fileName = name || '';
    $('#hve-cb-filename').textContent = state.fileName;
    state.undoStack = [];
    state.redoStack = [];
    updateHistoryButtons();
    window.scrollTo(0, 0);
    toast(t('Opened {name} — click Edit to start', { name: state.fileName || 'document' }), 'success');
  }

  /* ---------------------------------------------------------
   * 24. Paste & drop images
   * ------------------------------------------------------- */

  function onPaste(e) {
    if (!state.editMode || isUI(e.target)) return;
    const items = e.clipboardData && e.clipboardData.items;
    if (!items) return;
    for (const it of items) {
      if (it.type && it.type.startsWith('image/')) {
        e.preventDefault();
        const blob = it.getAsFile();
        const reader = new FileReader();
        reader.onload = () => {
          insertElements([makeImage(reader.result, t('Pasted image'))]);
        };
        reader.readAsDataURL(blob);
        return;
      }
    }
    // plain HTML/text paste while an element is selected → insert as text
    if (!state.editingEl && state.selected.length && !e.clipboardData.types.includes('Files')) {
      const text = e.clipboardData.getData('text/plain');
      if (text && text.trim()) {
        e.preventDefault();
        const p = el('p', { style: 'margin:12px 0;line-height:1.7;color:#3d3d3a;' });
        p.textContent = text.split('\n')[0];
        insertElements([p]);
      }
    }
  }

  let dragDepth = 0;

  function onDragOver(e) {
    if (!state.editMode) return;
    const hasFiles = e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');
    if (!hasFiles) return;
    e.preventDefault();
    dropOverlay.style.display = 'block';
  }

  function onDragLeave() {
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) dropOverlay.style.display = 'none';
  }

  function onDrop(e) {
    dropOverlay.style.display = 'none';
    dragDepth = 0;
    if (!state.editMode) return;
    const files = e.dataTransfer && e.dataTransfer.files;
    if (!files || !files.length) return;
    e.preventDefault();
    let inserted = 0;
    Array.from(files).forEach(f => {
      if (!f.type.startsWith('image/')) return;
      const reader = new FileReader();
      reader.onload = () => {
        insertElements([makeImage(reader.result, f.name)]);
        inserted++;
      };
      reader.readAsDataURL(f);
    });
    if (!inserted) toast(t('Only image files can be dropped'), 'error');
  }

  document.addEventListener('dragenter', () => { dragDepth++; });

  /* ---------------------------------------------------------
   * 25. Keyboard shortcuts
   * ------------------------------------------------------- */

  function nudge(dx, dy) {
    if (!state.selected.length) return;
    pushUndo('nudge:' + state.selected.map(s => indexOfEl(s)).join(','));
    forEachSelected(s => {
      if (isFloating(s)) {
        s.style.left = ((parseFloat(s.style.left) || 0) + dx) + 'px';
        s.style.top = ((parseFloat(s.style.top) || 0) + dy) + 'px';
      } else {
        const cs = getComputedStyle(s);
        if (cs.position === 'static') s.style.position = 'relative';
        s.style.left = ((parseFloat(s.style.left) || 0) + dx) + 'px';
        s.style.top = ((parseFloat(s.style.top) || 0) + dy) + 'px';
      }
    });
  }

  function onKeyDown(e) {
    if (!state.editMode) {
      if (modKey(e) && e.key.toLowerCase() === 's') { e.preventDefault(); saveAs(); }
      return;
    }
    // typing inside editor inputs (dialogs, hex field) — let them work
    const kt = e.target;
    if (kt && kt !== document.body && (kt.tagName === 'INPUT' || kt.tagName === 'SELECT' || kt.tagName === 'TEXTAREA') && isUI(kt)) {
      return;
    }
    if (kt && kt.tagName === 'INPUT' && !isUI(kt)) return; // page's own inputs

    const k = e.key.toLowerCase();
    const mod = modKey(e);

    // text-edit mode: let the browser handle native editing keys,
    // only intercept global save
    if (state.editingEl) {
      if (mod && k === 's') { e.preventDefault(); saveAs(); }
      if (e.key === 'Escape') { e.preventDefault(); exitTextEdit(); }
      if (mod && k === 'b') { try { document.execCommand('bold'); } catch (_) {} e.preventDefault(); }
      if (mod && k === 'i') { try { document.execCommand('italic'); } catch (_) {} e.preventDefault(); }
      if (mod && k === 'u') { try { document.execCommand('underline'); } catch (_) {} e.preventDefault(); }
      return;
    }

    if (mod && e.shiftKey && k === 'z') { e.preventDefault(); redo(); return; }
    if (mod && (k === 'z')) { e.preventDefault(); undo(); return; }
    if (mod && (k === 'y')) { e.preventDefault(); redo(); return; }
    if (mod && k === 's') { e.preventDefault(); saveAs(); return; }
    if (mod && k === 'o') { e.preventDefault(); openFilePicker(); return; }
    if (mod && k === 'd') { e.preventDefault(); duplicateSelection(); return; }
    if (mod && e.shiftKey && k === 'c') { e.preventDefault(); copyStyle(); return; }
    if (mod && e.shiftKey && k === 'v') { e.preventDefault(); pasteStyle(); return; }
    if (mod && e.shiftKey && k === 'g') { e.preventDefault(); ungroupSelection(); return; }
    if (mod && k === 'g') { e.preventDefault(); groupSelection(); return; }
    if (mod && k === 'l') { e.preventDefault(); toggleLock(); return; }
    if (mod && e.shiftKey && k === 'p') { e.preventDefault(); togglePanel('pages'); return; }
    if (mod && k === 'c') { e.preventDefault(); copyInternal(); return; }
    if (mod && k === 'x') { e.preventDefault(); cutInternal(); return; }
    if (mod && k === 'v') { e.preventDefault(); pasteInternal(); return; }
    if (mod && k === 'a') { e.preventDefault(); setSelection(topLevelElements().filter(x => !x.hasAttribute('data-hve-locked'))); return; }

    if (e.key === 'Escape') {
      e.preventDefault();
      if (openMenuEl) { closeDropdown(); return; }
      if (state.brush) { disarmBrush(); return; }
      if (state.selected.length > 1) { setSelection([state.selected[state.selected.length - 1]]); return; }
      selectParent();
      return;
    }

    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (state.selected.length) { e.preventDefault(); deleteSelection(); }
      return;
    }

    if (e.key === 'Enter' && state.selected.length === 1) {
      e.preventDefault();
      enterTextEdit(state.selected[0]);
      return;
    }

    const arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (arrows[e.key] && state.selected.length) {
      e.preventDefault();
      const [dx, dy] = arrows[e.key];
      const step = e.shiftKey ? 10 : 1;
      nudge(dx * step, dy * step);
    }
  }

  function onClickCapture(e) {
    if (!state.editMode) return;
    // prevent navigation while editing (but allow programmatic download links
    // such as the ones created by Save As)
    const a = e.target.closest && e.target.closest('a[href]');
    if (a && !isUI(a) && !a.hasAttribute('download')) e.preventDefault();
  }

  /* ---------------------------------------------------------
   * 26. Init
   * ------------------------------------------------------- */

  function init() {
    buildUI();

    // language: default Chinese, remember the last choice
    applyHeadLang();
    applyDocumentLang();

    document.addEventListener('mouseover', onMouseOver);
    document.addEventListener('mousedown', onMouseDown, true);
    document.addEventListener('dblclick', onDoubleClick);
    document.addEventListener('contextmenu', onContextMenu);
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('click', onClickCapture, true);
    document.addEventListener('paste', onPaste);
    document.addEventListener('dragover', onDragOver);
    document.addEventListener('dragleave', onDragLeave);
    document.addEventListener('drop', onDrop);

    // click outside dropdown closes it
    document.addEventListener('mousedown', (e) => {
      if (openMenuEl && !openMenuEl.contains(e.target)) closeDropdown();
    }, true);

    // prevent accidental unload when there are unsaved edits
    window.addEventListener('beforeunload', (e) => {
      if (state.undoStack.length > 0) {
        e.preventDefault();
        e.returnValue = '';
      }
    });

    updateHistoryButtons();
    updateToolbarState();

    console.log('%c HVE %c Visual HTML Editor ready — press "Edit" to start ',
      'background:#cc785c;color:#fff;border-radius:3px 0 0 3px;padding:2px 6px;font-weight:700',
      'background:#efe9de;color:#141413;border-radius:0 3px 3px 0;padding:2px 6px');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // public API (handy for debugging / automation)
  window.HVE = {
    state, undo, redo, saveAs, toggleEditMode, openFilePicker,
    setSelection, toast, serializeDocument, setLang, t
  };
})();
