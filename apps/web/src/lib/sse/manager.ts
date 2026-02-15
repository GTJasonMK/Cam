// ============================================================
// SSE 事件管理器
// 维护所有 SSE 连接，广播系统事件给前端客户端
// ============================================================

import { sendWebhookEvent } from '@/lib/notifications/webhook';

type SSEClient = {
  id: string;
  controller: ReadableStreamDefaultController;
};

class SSEManager {
  private clients: Map<string, SSEClient> = new Map();

  /** 注册一个新的 SSE 客户端连接 */
  addClient(id: string, controller: ReadableStreamDefaultController): void {
    this.clients.set(id, { id, controller });
    console.log(`[SSE] 客户端连接: ${id}, 当前连接数: ${this.clients.size}`);
  }

  /** 移除一个 SSE 客户端连接 */
  removeClient(id: string): void {
    this.clients.delete(id);
    console.log(`[SSE] 客户端断开: ${id}, 当前连接数: ${this.clients.size}`);
  }

  /** 向所有连接的客户端广播事件 */
  broadcast(eventType: string, payload: Record<string, unknown>): void {
    // Webhook 推送采用异步 fire-and-forget，不阻塞主链路
    sendWebhookEvent(eventType, payload);

    const data = JSON.stringify({ type: eventType, payload, timestamp: new Date().toISOString() });
    const message = `data: ${data}\n\n`;

    const encoder = new TextEncoder();
    const encoded = encoder.encode(message);

    for (const [id, client] of this.clients) {
      try {
        client.controller.enqueue(encoded);
      } catch {
        // 客户端可能已断开，清理
        this.clients.delete(id);
      }
    }
  }

  /** 获取当前连接数 */
  getClientCount(): number {
    return this.clients.size;
  }
}

// 全局单例
export const sseManager = new SSEManager();
