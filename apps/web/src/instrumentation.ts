// ============================================================
// Next.js Server Instrumentation Hook
// 使用官方推荐的分文件模式：通过 NEXT_RUNTIME 条件动态导入
// Node.js 专用逻辑，webpack 在 Edge 编译时会对该条件做死代码消除，
// 不会追踪 instrumentation-node.ts 的依赖链
// ============================================================

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./instrumentation-node');
  }
}
