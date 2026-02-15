'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/input';

type FeedbackToastType = 'info' | 'success' | 'error';

type ToastInput = {
  title?: string;
  message: string;
  type?: FeedbackToastType;
  durationMs?: number;
};

type ConfirmInput = {
  title: string;
  description?: string;
  confirmText?: string;
  cancelText?: string;
  confirmVariant?: 'primary' | 'destructive' | 'success' | 'secondary';
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

type ToastItem = ToastInput & {
  id: string;
  type: FeedbackToastType;
  durationMs: number;
};

type ConfirmState = ConfirmInput & {
  resolve: (result: boolean) => void;
};

type PromptState = PromptInput & {
  resolve: (result: string | null) => void;
};

type FeedbackContextValue = {
  notify: (input: ToastInput) => void;
  confirm: (input: ConfirmInput) => Promise<boolean>;
  prompt: (input: PromptInput) => Promise<string | null>;
};

const FeedbackContext = createContext<FeedbackContextValue | null>(null);

function randomId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

const TOAST_TONE_CLASS: Record<FeedbackToastType, string> = {
  info: 'border-primary/35',
  success: 'border-success/40',
  error: 'border-destructive/45',
};

export function FeedbackProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const [promptState, setPromptState] = useState<PromptState | null>(null);
  const [promptValue, setPromptValue] = useState('');
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const removeToast = useCallback((id: string) => {
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const notify = useCallback(
    (input: ToastInput) => {
      const id = randomId();
      const toast: ToastItem = {
        id,
        title: input.title,
        message: input.message,
        type: input.type || 'info',
        durationMs: input.durationMs ?? 3200,
      };
      setToasts((prev) => [...prev, toast]);

      const timer = setTimeout(() => {
        removeToast(id);
      }, toast.durationMs);
      timersRef.current.set(id, timer);
    },
    [removeToast]
  );

  const confirm = useCallback((input: ConfirmInput) => {
    return new Promise<boolean>((resolve) => {
      setConfirmState({
        confirmText: input.confirmText || '确认',
        cancelText: input.cancelText || '取消',
        confirmVariant: input.confirmVariant || 'primary',
        title: input.title,
        description: input.description,
        resolve,
      });
    });
  }, []);

  const prompt = useCallback((input: PromptInput) => {
    return new Promise<string | null>((resolve) => {
      setPromptValue(input.defaultValue || '');
      setPromptState({
        title: input.title,
        description: input.description,
        label: input.label,
        placeholder: input.placeholder,
        required: input.required,
        multiline: input.multiline,
        defaultValue: input.defaultValue,
        confirmText: input.confirmText || '确认',
        cancelText: input.cancelText || '取消',
        resolve,
      });
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
    setPromptValue('');
  }, []);

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      for (const timer of timers.values()) {
        clearTimeout(timer);
      }
      timers.clear();
    };
  }, []);

  const contextValue = useMemo(
    () => ({
      notify,
      confirm,
      prompt,
    }),
    [notify, confirm, prompt]
  );

  const promptSubmitDisabled = Boolean(promptState?.required) && promptValue.trim().length === 0;

  return (
    <FeedbackContext.Provider value={contextValue}>
      {children}

      {/* Toast Stack */}
      <div className="pointer-events-none fixed right-4 top-4 z-[120] flex w-[min(90vw,360px)] flex-col gap-2">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`pointer-events-auto rounded-xl border bg-card p-3 shadow-lg ${TOAST_TONE_CLASS[toast.type]}`}
          >
            {toast.title ? <p className="text-xs font-semibold text-foreground">{toast.title}</p> : null}
            <p className={`text-xs ${toast.title ? 'mt-1 text-muted-foreground' : 'text-foreground'}`}>{toast.message}</p>
            <div className="mt-2 flex justify-end">
              <Button size="sm" variant="ghost" onClick={() => removeToast(toast.id)}>
                关闭
              </Button>
            </div>
          </div>
        ))}
      </div>

      {/* Confirm Dialog */}
      {confirmState ? (
        <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/50 px-4">
          <div className="w-full max-w-md rounded-2xl border border-border bg-card p-5 shadow-2xl">
            <p className="text-sm font-semibold text-foreground">{confirmState.title}</p>
            {confirmState.description ? (
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{confirmState.description}</p>
            ) : null}
            <div className="mt-5 flex justify-end gap-2">
              <Button size="sm" variant="secondary" onClick={() => closeConfirm(false)}>
                {confirmState.cancelText || '取消'}
              </Button>
              <Button
                size="sm"
                variant={confirmState.confirmVariant || 'primary'}
                onClick={() => closeConfirm(true)}
              >
                {confirmState.confirmText || '确认'}
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Prompt Dialog */}
      {promptState ? (
        <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/50 px-4">
          <div className="w-full max-w-lg rounded-2xl border border-border bg-card p-5 shadow-2xl">
            <p className="text-sm font-semibold text-foreground">{promptState.title}</p>
            {promptState.description ? (
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{promptState.description}</p>
            ) : null}
            <div className="mt-4">
              {promptState.multiline ? (
                <Textarea
                  label={promptState.label}
                  rows={4}
                  value={promptValue}
                  placeholder={promptState.placeholder}
                  onChange={(e) => setPromptValue(e.target.value)}
                />
              ) : (
                <Input
                  label={promptState.label}
                  value={promptValue}
                  placeholder={promptState.placeholder}
                  onChange={(e) => setPromptValue(e.target.value)}
                />
              )}
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <Button size="sm" variant="secondary" onClick={() => closePrompt(null)}>
                {promptState.cancelText || '取消'}
              </Button>
              <Button
                size="sm"
                variant="primary"
                disabled={promptSubmitDisabled}
                onClick={() => closePrompt(promptState.required ? promptValue.trim() : promptValue)}
              >
                {promptState.confirmText || '确认'}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
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
