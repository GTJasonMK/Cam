// ============================================================
// 文件管理面板
// 目录+文件浏览、上传（带进度）、下载（带进度）
// ============================================================

'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronRight,
  Download,
  FileCode,
  FileText,
  FileImage,
  FileArchive,
  File,
  FolderOpen,
  Loader2,
  RefreshCw,
  Search,
  Upload,
  X,
  HardDrive,
  FileJson,
  FileCog,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FILE_MANAGER_UI_MESSAGES as MSG } from '@/lib/i18n/ui-messages';
import {
  formatFileSize,
  getFileCategory,
  uploadFile,
  downloadFile,
  triggerBrowserDownload,
  type TransferProgress,
  type UploadHandle,
} from '@/lib/terminal/file-transfer';
import type { FileEntry } from '@/app/api/terminal/browse/route';
import { cn } from '@/lib/utils';

// ---- 类型 ----

interface DirectoryEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  isGitRepo: boolean;
  hasClaude: boolean;
  hasCodex: boolean;
}

interface BrowseResult {
  currentPath: string;
  parentPath: string | null;
  entries: DirectoryEntry[];
  files?: FileEntry[];
  fileCount?: number;
}

type TransferStatus = 'active' | 'completed' | 'failed' | 'cancelled';

interface TransferTask {
  id: string;
  fileName: string;
  type: 'upload' | 'download';
  loaded: number;
  total: number;
  status: TransferStatus;
  error?: string;
  abort?: () => void;
}

// ---- 图标工具 ----

function FileIcon({ ext, className }: { ext: string; className?: string }) {
  const category = getFileCategory(ext);
  const props = { size: 16, className };
  switch (category) {
    case 'code': return <FileCode {...props} />;
    case 'text': return <FileText {...props} />;
    case 'image': return <FileImage {...props} />;
    case 'archive': return <FileArchive {...props} />;
    case 'data': return <FileJson {...props} />;
    case 'config': return <FileCog {...props} />;
    default: return <File {...props} />;
  }
}

// ---- 日期格式化 ----

function formatShortDate(isoStr: string): string {
  if (!isoStr) return '';
  try {
    const d = new Date(isoStr);
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const mi = String(d.getMinutes()).padStart(2, '0');
    return `${mm}-${dd} ${hh}:${mi}`;
  } catch {
    return '';
  }
}

// ---- 面板组件 ----

export default function FileManagerPanel() {
  const [currentPath, setCurrentPath] = useState('');
  const [parentPath, setParentPath] = useState<string | null>(null);
  const [entries, setEntries] = useState<DirectoryEntry[]>([]);
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchKeyword, setSearchKeyword] = useState('');
  const [transfers, setTransfers] = useState<TransferTask[]>([]);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadHandlesRef = useRef<Map<string, UploadHandle>>(new Map());
  const abortControllersRef = useRef<Map<string, AbortController>>(new Map());

  // ---- 浏览 ----

  const browse = useCallback(async (path: string) => {
    setLoading(true);
    setError(null);
    setSearchKeyword('');

    try {
      const params = new URLSearchParams();
      if (path) params.set('path', path);
      params.set('includeFiles', 'true');

      const res = await fetch(`/api/terminal/browse?${params.toString()}`);
      if (!res.ok) {
        const json = await res.json().catch(() => null);
        throw new Error(json?.error?.message || `HTTP ${res.status}`);
      }

      const json = await res.json();
      if (!json.success) {
        throw new Error(json.error?.message || '请求失败');
      }

      const data = json.data as BrowseResult;
      setCurrentPath(data.currentPath);
      setParentPath(data.parentPath);
      setEntries(data.entries || []);
      setFiles(data.files || []);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  // 初始加载
  useEffect(() => {
    void browse('');
  }, [browse]);

  // ---- 筛选 ----

  const kw = searchKeyword.trim().toLowerCase();

  const filteredEntries = useMemo(
    () => kw ? entries.filter((e) => e.name.toLowerCase().includes(kw)) : entries,
    [entries, kw],
  );

  const filteredFiles = useMemo(
    () => kw ? files.filter((f) => f.name.toLowerCase().includes(kw)) : files,
    [files, kw],
  );

  const hasContent = filteredEntries.length > 0 || filteredFiles.length > 0;

  // ---- 上传 ----

  const handleUpload = useCallback((fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;

    for (let i = 0; i < fileList.length; i++) {
      const file = fileList[i];
      const id = `upload-${Date.now()}-${i}`;

      const task: TransferTask = {
        id,
        fileName: file.name,
        type: 'upload',
        loaded: 0,
        total: file.size,
        status: 'active',
      };

      const handle = uploadFile(file, currentPath, (progress: TransferProgress) => {
        setTransfers((prev) =>
          prev.map((t) => t.id === id ? { ...t, loaded: progress.loaded, total: progress.total } : t),
        );
      });

      task.abort = () => handle.abort();
      uploadHandlesRef.current.set(id, handle);

      setTransfers((prev) => [...prev, task]);

      handle.promise
        .then(() => {
          setTransfers((prev) =>
            prev.map((t) => t.id === id ? { ...t, status: 'completed', loaded: t.total } : t),
          );
          // 上传完成后刷新目录
          void browse(currentPath);
        })
        .catch((err: Error) => {
          if (err.message === '上传已取消') {
            setTransfers((prev) =>
              prev.map((t) => t.id === id ? { ...t, status: 'cancelled' } : t),
            );
          } else {
            setTransfers((prev) =>
              prev.map((t) => t.id === id ? { ...t, status: 'failed', error: err.message } : t),
            );
          }
        })
        .finally(() => {
          uploadHandlesRef.current.delete(id);
        });
    }

    // 清空 file input
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [currentPath, browse]);

  // ---- 下载 ----

  const handleDownload = useCallback((file: FileEntry) => {
    const id = `download-${Date.now()}`;
    const controller = new AbortController();
    abortControllersRef.current.set(id, controller);

    const task: TransferTask = {
      id,
      fileName: file.name,
      type: 'download',
      loaded: 0,
      total: file.size,
      status: 'active',
      abort: () => controller.abort(),
    };

    setTransfers((prev) => [...prev, task]);

    downloadFile(
      file.path,
      (progress: TransferProgress) => {
        setTransfers((prev) =>
          prev.map((t) => t.id === id ? { ...t, loaded: progress.loaded, total: progress.total } : t),
        );
      },
      controller.signal,
    )
      .then((blob) => {
        triggerBrowserDownload(blob, file.name);
        setTransfers((prev) =>
          prev.map((t) => t.id === id ? { ...t, status: 'completed', loaded: t.total } : t),
        );
      })
      .catch((err: Error) => {
        if (err.name === 'AbortError') {
          setTransfers((prev) =>
            prev.map((t) => t.id === id ? { ...t, status: 'cancelled' } : t),
          );
        } else {
          setTransfers((prev) =>
            prev.map((t) => t.id === id ? { ...t, status: 'failed', error: err.message } : t),
          );
        }
      })
      .finally(() => {
        abortControllersRef.current.delete(id);
      });
  }, []);

  // ---- 取消传输 ----

  const cancelTransfer = useCallback((id: string) => {
    const uploadHandle = uploadHandlesRef.current.get(id);
    if (uploadHandle) {
      uploadHandle.abort();
      return;
    }
    const controller = abortControllersRef.current.get(id);
    if (controller) {
      controller.abort();
    }
  }, []);

  // ---- 清除已完成传输 ----

  const clearCompletedTransfers = useCallback(() => {
    setTransfers((prev) => prev.filter((t) => t.status === 'active'));
  }, []);

  // ---- 面包屑 ----

  const breadcrumbs = useMemo(() => {
    if (!currentPath) return [];
    // Windows: 'E:\Code\Cam' → ['E:', 'Code', 'Cam']
    // Unix: '/home/user' → ['', 'home', 'user']
    const sep = currentPath.includes('\\') ? '\\' : '/';
    const parts = currentPath.split(sep).filter(Boolean);
    const crumbs: { label: string; path: string }[] = [];

    for (let i = 0; i < parts.length; i++) {
      const path = currentPath.includes('\\')
        ? parts.slice(0, i + 1).join('\\') + (i === 0 ? '\\' : '')
        : '/' + parts.slice(0, i + 1).join('/');
      crumbs.push({ label: parts[i], path });
    }

    return crumbs;
  }, [currentPath]);

  // ---- 活跃传输 ----
  const activeTransfers = useMemo(() => transfers.filter((t) => t.status === 'active'), [transfers]);
  const completedTransfers = useMemo(
    () => transfers.filter((t) => t.status !== 'active'),
    [transfers],
  );

  return (
    <div className="space-y-4">
      {/* 工具栏 */}
      <div className="flex flex-col gap-3 rounded-xl border border-border bg-card/70 px-3 py-3 sm:flex-row sm:items-center sm:gap-4 sm:px-5 sm:py-4">
        {/* 面包屑导航 */}
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto text-sm">
          <button
            type="button"
            onClick={() => void browse('')}
            className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
          >
            <HardDrive size={16} />
          </button>
          {breadcrumbs.map((crumb, i) => (
            <span key={crumb.path} className="flex shrink-0 items-center gap-1">
              <ChevronRight size={14} className="text-muted-foreground/50" />
              {i === breadcrumbs.length - 1 ? (
                <span className="font-medium text-foreground">{crumb.label}</span>
              ) : (
                <button
                  type="button"
                  onClick={() => void browse(crumb.path)}
                  className="text-muted-foreground transition-colors hover:text-foreground"
                >
                  {crumb.label}
                </button>
              )}
            </span>
          ))}
        </div>

        {/* 搜索 + 操作按钮 */}
        <div className="flex items-center gap-2">
          <div className="relative w-48">
            <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchKeyword}
              onChange={(e) => setSearchKeyword(e.target.value)}
              placeholder={MSG.toolbar.search}
              className="h-9 pl-8 text-sm"
            />
          </div>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => handleUpload(e.target.files)}
          />
          <Button
            variant="secondary"
            size="sm"
            className="h-9"
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload size={14} className="mr-1.5" />
            {MSG.toolbar.upload}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-9"
            onClick={() => void browse(currentPath)}
            disabled={loading}
          >
            <RefreshCw size={14} className={cn(loading && 'animate-spin')} />
          </Button>
        </div>
      </div>

      {/* 错误提示 */}
      {error && (
        <div className="rounded-lg border border-destructive/25 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {MSG.errors.loadFailed}: {error}
        </div>
      )}

      {/* 加载状态 */}
      {loading && entries.length === 0 && files.length === 0 && (
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          <Loader2 size={20} className="mr-2 animate-spin" />
          加载中...
        </div>
      )}

      {/* 文件列表 */}
      {!loading || entries.length > 0 || files.length > 0 ? (
        <div className="overflow-hidden rounded-xl border border-border">
          {/* 表头 */}
          <div className="flex items-center border-b border-border bg-muted/30 px-4 py-2 text-xs font-medium text-muted-foreground">
            <span className="flex-1">{MSG.columns.name}</span>
            <span className="hidden w-24 text-right sm:block">{MSG.columns.size}</span>
            <span className="hidden w-32 text-right sm:block">{MSG.columns.modified}</span>
            <span className="w-20 text-right">{MSG.columns.actions}</span>
          </div>

          {/* 返回上级目录 */}
          {parentPath !== null && (
            <button
              type="button"
              onClick={() => void browse(parentPath)}
              className="flex w-full items-center gap-3 border-b border-border px-4 py-2.5 text-sm transition-colors hover:bg-muted/30"
            >
              <FolderOpen size={16} className="text-primary/70" />
              <span className="text-muted-foreground">..</span>
            </button>
          )}

          {/* 目录列表 */}
          {filteredEntries.map((entry) => (
            <button
              key={entry.path}
              type="button"
              onClick={() => void browse(entry.path)}
              className="flex w-full items-center gap-3 border-b border-border px-4 py-2.5 text-sm transition-colors hover:bg-muted/30"
            >
              <FolderOpen size={16} className="shrink-0 text-primary/70" />
              <span className="min-w-0 flex-1 truncate text-left font-medium">
                {entry.name}
                {entry.isGitRepo && (
                  <span className="ml-2 text-[11px] text-muted-foreground">Git</span>
                )}
              </span>
            </button>
          ))}

          {/* 文件列表 */}
          {filteredFiles.map((file) => (
            <div
              key={file.path}
              className="flex items-center gap-3 border-b border-border px-4 py-2.5 text-sm last:border-b-0"
            >
              <FileIcon ext={file.extension} className="shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate">{file.name}</span>
              <span className="hidden w-24 shrink-0 text-right text-xs text-muted-foreground sm:block">
                {formatFileSize(file.size)}
              </span>
              <span className="hidden w-32 shrink-0 text-right text-xs text-muted-foreground sm:block">
                {formatShortDate(file.modifiedAt)}
              </span>
              <span className="w-20 shrink-0 text-right">
                <button
                  type="button"
                  onClick={() => handleDownload(file)}
                  className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
                >
                  <Download size={12} />
                  {MSG.actions.download}
                </button>
              </span>
            </div>
          ))}

          {/* 空状态 */}
          {!hasContent && !loading && (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">
              {kw ? MSG.empty.noMatch : MSG.empty.noEntries}
            </div>
          )}
        </div>
      ) : null}

      {/* 传输进度面板 */}
      {transfers.length > 0 && (
        <div className="space-y-2 rounded-xl border border-border bg-card/70 px-4 py-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">
              传输任务 ({activeTransfers.length} 活跃)
            </span>
            {completedTransfers.length > 0 && (
              <button
                type="button"
                onClick={clearCompletedTransfers}
                className="text-[11px] text-muted-foreground transition-colors hover:text-foreground"
              >
                清除已完成
              </button>
            )}
          </div>

          {transfers.map((task) => {
            const percent = task.total > 0 ? Math.round((task.loaded / task.total) * 100) : 0;
            return (
              <div key={task.id} className="flex items-center gap-3 text-sm">
                {task.type === 'upload' ? (
                  <Upload size={14} className="shrink-0 text-primary" />
                ) : (
                  <Download size={14} className="shrink-0 text-primary" />
                )}
                <span className="min-w-0 flex-1 truncate text-xs">{task.fileName}</span>

                {task.status === 'active' && (
                  <>
                    <div className="h-1.5 w-24 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-primary transition-all"
                        style={{ width: `${percent}%` }}
                      />
                    </div>
                    <span className="w-10 text-right text-[11px] text-muted-foreground">{percent}%</span>
                    <button
                      type="button"
                      onClick={() => cancelTransfer(task.id)}
                      className="shrink-0 text-muted-foreground transition-colors hover:text-destructive"
                    >
                      <X size={14} />
                    </button>
                  </>
                )}

                {task.status === 'completed' && (
                  <span className="text-[11px] text-success">{MSG.transfer.completed}</span>
                )}
                {task.status === 'failed' && (
                  <span className="text-[11px] text-destructive" title={task.error}>
                    {MSG.transfer.failed}
                  </span>
                )}
                {task.status === 'cancelled' && (
                  <span className="text-[11px] text-muted-foreground">{MSG.transfer.cancelled}</span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
