// 提示输入对话框 — 从 FeedbackProvider 延迟加载
// 仅在用户触发 prompt() 时才加载 Radix Dialog 依赖

'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';

interface PromptDialogProps {
  open: boolean;
  title: string;
  description?: string;
  label?: string;
  placeholder?: string;
  defaultValue?: string;
  required?: boolean;
  multiline?: boolean;
  confirmText?: string;
  cancelText?: string;
  onResult: (result: string | null) => void;
}

export default function FeedbackPromptDialog({
  open,
  title,
  description,
  label,
  placeholder,
  defaultValue,
  required,
  multiline,
  confirmText,
  cancelText,
  onResult,
}: PromptDialogProps) {
  const [value, setValue] = useState(defaultValue || '');
  const submitDisabled = Boolean(required) && value.trim().length === 0;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onResult(null); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? (
            <DialogDescription>{description}</DialogDescription>
          ) : null}
        </DialogHeader>
        <div className="px-5 py-4">
          {multiline ? (
            <Textarea
              label={label}
              rows={4}
              value={value}
              placeholder={placeholder}
              onChange={(e) => setValue(e.target.value)}
            />
          ) : (
            <Input
              label={label}
              value={value}
              placeholder={placeholder}
              onChange={(e) => setValue(e.target.value)}
            />
          )}
        </div>
        <div className="flex justify-end gap-2 border-t border-border bg-muted/30 px-5 py-3 rounded-b-xl">
          <Button size="sm" variant="secondary" onClick={() => onResult(null)}>
            {cancelText || '取消'}
          </Button>
          <Button
            size="sm"
            disabled={submitDisabled}
            onClick={() => onResult(required ? value.trim() : value)}
          >
            {confirmText || '确认'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
