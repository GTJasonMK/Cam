// z-index 层级常量
// 与 globals.css @theme 中的 --z-index-* 令牌保持同步
// 用于需要在 JS 中引用 z-index 的场景（如 inline style）
export const Z_INDEX = {
  /** 噪点纹理叠加层（纯装饰，pointer-events: none） */
  NOISE: 0,
  /** DataTable 粘性表头 */
  TABLE_STICKY: 10,
  /** 侧边栏遮罩（移动端） */
  SIDEBAR_BACKDROP: 40,
  /** 侧边栏面板（移动端） */
  SIDEBAR: 50,
  /** Modal 遮罩层 */
  MODAL: 100,
  /** Toast 消息 */
  TOAST: 120,
  /** 确认/输入弹窗（最高交互层） */
  DIALOG: 130,
} as const;
