// className 合并工具
// clsx 处理条件类名，tailwind-merge 解决 Tailwind 类冲突
import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
