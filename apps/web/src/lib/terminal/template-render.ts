// ============================================================
// 模板变量提取与渲染
// 复用 taskTemplates 中的 {{变量}} 占位符语法
// ============================================================

/** 从模板字符串提取 {{变量名}} 列表（去重） */
export function extractTemplateVars(template: string): string[] {
  const matches = template.matchAll(/\{\{(\w+)\}\}/g);
  return [...new Set([...matches].map((m) => m[1]))];
}

/** 渲染模板：替换 {{变量名}} 为实际值 */
export function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? '');
}
