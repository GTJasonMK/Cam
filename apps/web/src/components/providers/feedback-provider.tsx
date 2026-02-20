// 反馈系统 — Toast(Sonner) + Confirm(AlertDialog) + Prompt(Dialog)
// AlertDialog 和 Dialog 通过 dynamic import 延迟加载，减少首屏 JS

'use client';

import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';

// 对话框组件延迟加载 — 首屏不需要 Radix AlertDialog / Dialog 的 JS
const LazyConfirmDialog = dynamic(() => import('./feedback-confirm-dialog'));
const LazyPromptDialog = dynamic(() => import('./feedback-prompt-dialog'));

/* ---- 类型 ---- */

type ToastInput = {
  title?: string;
  message: string;
  type?: 'info' | 'success' | 'error';
  durationMs?: number;
};

type ConfirmInput = {
  title: string;
  description?: string;
  confirmText?: string;
  cancelText?: string;
  confirmVariant?: 'default' | 'destructive' | 'success' | 'secondary';
};

type PromptInput = {
  title: string;
  description?: string;
  label?: string;
  placeholder?: string;
  defaultValue?: string;
  required?: boolean;
  multiline?: boolean;
  confirmText?: string;
  cancelText?: string;
};

type FeedbackContextValue = {
  notify: (input: ToastInput) => void;
  confirm: (input: ConfirmInput) => Promise<boolean>;
  prompt: (input: PromptInput) => Promise<string | null>;
};

/* ---- Context ---- */

const FeedbackContext = createContext<FeedbackContextValue | null>(null);

/* ---- 内部状态类型 ---- */

type ConfirmState = ConfirmInput & { resolve: (result: boolean) => void };
type PromptState = PromptInput & { resolve: (result: string | null) => void };

/* ---- Provider ---- */

export function FeedbackProvider({ children }: { children: React.ReactNode }) {
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const [promptState, setPromptState] = useState<PromptState | null>(null);

  // Toast（延迟加载 sonner，首屏不需要 toast 渲染模块）
  const notify = useCallback((input: ToastInput) => {
    void import('sonner').then(({ toast }) => {
      const opts = { description: input.message, duration: input.durationMs ?? 3200 };
      switch (input.type) {
        case 'success':
          toast.success(input.title || '成功', opts);
          break;
        case 'error':
          toast.error(input.title || '错误', opts);
          break;
        default:
          toast.info(input.title || '提示', opts);
      }
    });
  }, []);

  // Confirm
  const confirm = useCallback((input: ConfirmInput) => {
    return new Promise<boolean>((resolve) => {
      setConfirmState({ ...input, resolve });
    });
  }, []);

  // Prompt
  const prompt = useCallback((input: PromptInput) => {
    return new Promise<string | null>((resolve) => {
      setPromptState({ ...input, resolve });
    });
  }, []);

  const closeConfirm = useCallback((result: boolean) => {
    setConfirmState((prev) => {
      if (prev) prev.resolve(result);
      return null;
    });
  }, []);

  const closePrompt = useCallback((result: string | null) => {
    setPromptState((prev) => {
      if (prev) prev.resolve(result);
      return null;
    });
  }, []);

  const contextValue = useMemo(() => ({ notify, confirm, prompt }), [notify, confirm, prompt]);

  return (
    <FeedbackContext.Provider value={contextValue}>
      {children}

      {/* 确认对话框 — 仅在触发时加载 Radix AlertDialog */}
      {confirmState && (
        <LazyConfirmDialog
          open
          title={confirmState.title}
          description={confirmState.description}
          confirmText={confirmState.confirmText}
          cancelText={confirmState.cancelText}
          confirmVariant={confirmState.confirmVariant}
          onResult={closeConfirm}
        />
      )}

      {/* 提示输入对话框 — 仅在触发时加载 Radix Dialog */}
      {promptState && (
        <LazyPromptDialog
          open
          title={promptState.title}
          description={promptState.description}
          label={promptState.label}
          placeholder={promptState.placeholder}
          defaultValue={promptState.defaultValue}
          required={promptState.required}
          multiline={promptState.multiline}
          confirmText={promptState.confirmText}
          cancelText={promptState.cancelText}
          onResult={closePrompt}
        />
      )}
    </FeedbackContext.Provider>
  );
}

export function useFeedback(): FeedbackContextValue {
  const context = useContext(FeedbackContext);
  if (!context) {
    throw new Error('useFeedback must be used within <FeedbackProvider>');
  }
  return context;
}
