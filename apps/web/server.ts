// ============================================================
// 自定义 HTTP 服务器
// 包装 Next.js App Router + WebSocket upgrade 处理
// 开发: pnpm dev  → npm_lifecycle_event='dev'  → NODE_ENV=development
// 生产: pnpm start → npm_lifecycle_event='start' → NODE_ENV=production
// ============================================================

import { createServer } from 'http';
import { parse } from 'url';
import next from 'next';
import { WebSocketServer } from 'ws';
import { authenticateWs, canAccessTerminal } from '@/lib/terminal/ws-auth';
import { handleTerminalConnection } from '@/lib/terminal/ws-handler';
import { ptyManager } from '@/lib/terminal/pty-manager';

// 通过 npm_lifecycle_event 自动推断运行模式（dev vs start）
if (!process.env.NODE_ENV) {
  (process.env as Record<string, string | undefined>).NODE_ENV =
    process.env.npm_lifecycle_event === 'dev' ? 'development' : 'production';
}

const dev = process.env.NODE_ENV !== 'production';
// Windows 的 HOSTNAME 是机器名（会解析为 IPv6），用 HOST 替代
const hostname = process.env.HOST || '0.0.0.0';
const port = parseInt(process.env.PORT || '3000', 10);

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const upgrade = app.getUpgradeHandler();
  const server = createServer((req, res) => {
    const parsedUrl = parse(req.url!, true);
    handle(req, res, parsedUrl);
  });

  // WebSocket 服务器（noServer 模式，手动处理 upgrade）
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', async (req, socket, head) => {
    const { pathname } = parse(req.url || '');

    if (pathname === '/api/terminal/ws') {
      try {
        // 认证
        const user = await authenticateWs(req);
        if (!user) {
          socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
          socket.destroy();
          return;
        }

        // 权限检查
        if (!canAccessTerminal(user)) {
          socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
          socket.destroy();
          return;
        }

        // 升级连接
        wss.handleUpgrade(req, socket, head, (ws) => {
          handleTerminalConnection(ws, user);
        });
      } catch (err) {
        console.error('[Terminal] WebSocket upgrade 失败:', err);
        socket.write('HTTP/1.1 500 Internal Server Error\r\n\r\n');
        socket.destroy();
      }
    } else {
      // 其他 WebSocket 请求交给 Next.js（如 HMR）
      upgrade(req, socket, head);
    }
  });

  server.listen(port, hostname, () => {
    const displayHost = hostname === '0.0.0.0' ? 'localhost' : hostname;
    console.log(`> 服务器就绪: http://${displayHost}:${port}`);
    console.log(`> 终端 WebSocket: ws://${displayHost}:${port}/api/terminal/ws`);
    console.log(`> 模式: ${dev ? '开发' : '生产'}`);
  });

  // 优雅关闭
  const shutdown = () => {
    console.log('\n> 正在关闭服务器...');
    ptyManager.destroyAll();
    wss.close();
    server.close(() => {
      console.log('> 服务器已关闭');
      process.exit(0);
    });
    // 强制退出保底
    setTimeout(() => process.exit(1), 5000);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
});
