// 确认对话框 — 从 FeedbackProvider 延迟加载
// 仅在用户触发 confirm() 时才加载 Radix AlertDialog 依赖

'use client';

import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from '@/components/ui/alert-dialog';
import { cn } from '@/lib/utils';
import { buttonVariants } from '@/components/ui/button';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description?: string;
  confirmText?: string;
  cancelText?: string;
  confirmVariant?: 'default' | 'destructive' | 'success' | 'secondary';
  onResult: (result: boolean) => void;
}

export default function FeedbackConfirmDialog({
  open,
  title,
  description,
  confirmText,
  cancelText,
  confirmVariant,
  onResult,
}: ConfirmDialogProps) {
  const confirmBtnClass = confirmVariant
    ? cn(buttonVariants({ variant: confirmVariant, size: 'sm' }))
    : undefined;

  return (
    <AlertDialog open={open} onOpenChange={(v) => { if (!v) onResult(false); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {description ? (
            <AlertDialogDescription>{description}</AlertDialogDescription>
          ) : null}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => onResult(false)}>
            {cancelText || '取消'}
          </AlertDialogCancel>
          <AlertDialogAction className={confirmBtnClass} onClick={() => onResult(true)}>
            {confirmText || '确认'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
