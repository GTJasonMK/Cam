# CAM 服务器部署说明

本目录提供可直接用于生产服务器的部署配置。

## 目录结构

- `docker-compose.server.yml`: 生产 compose（web 监听 `127.0.0.1:3000`）
- `.env.prod.example`: 生产环境变量模板
- `nginx/cam.http.conf.template`: Nginx 反向代理模板（HTTP）
- `scripts/first-deploy.sh`: 首次部署脚本
- `scripts/upgrade.sh`: 升级脚本

## 一、首次部署

1. 复制并填写环境变量：

```bash
cp deploy/server/.env.prod.example deploy/server/.env.prod
```

2. 修改 `deploy/server/.env.prod`（至少填写）：

- `DOMAIN`
- `CAM_PUBLIC_BASE_URL`
- `CAM_COOKIE_DOMAIN`
- `CAM_AUTH_TOKEN`
- `CAM_MASTER_KEY`

3. 执行首次部署：

```bash
bash deploy/server/scripts/first-deploy.sh
```

## 二、配置 Nginx + HTTPS

1. 生成 Nginx 配置：

```bash
DOMAIN=cam.example.com
sed "s/__DOMAIN__/${DOMAIN}/g" \
  deploy/server/nginx/cam.http.conf.template \
  | sudo tee /etc/nginx/sites-available/cam.conf >/dev/null
```

2. 启用配置并重载：

```bash
sudo ln -sf /etc/nginx/sites-available/cam.conf /etc/nginx/sites-enabled/cam.conf
sudo nginx -t
sudo systemctl reload nginx
```

3. 签发证书（Let’s Encrypt）：

```bash
sudo certbot --nginx -d cam.example.com
```

## 三、升级

```bash
bash deploy/server/scripts/upgrade.sh
```

## 四、运行验证

```bash
curl -fsS http://127.0.0.1:3000/api/health
docker compose -f deploy/server/docker-compose.server.yml --env-file deploy/server/.env.prod ps
docker compose -f deploy/server/docker-compose.server.yml --env-file deploy/server/.env.prod logs -f web
```

## 五、注意事项

- 调度器会动态启动 worker 容器，必须保持 Docker Socket 挂载：
  - `/var/run/docker.sock:/var/run/docker.sock`
- 任务执行依赖 worker 镜像：
  - `cam-worker:claude-code`
  - `cam-worker:codex`
  - `cam-worker:aider`
- 若开启 OAuth，回调地址需与公网地址一致：
  - `https://<domain>/api/auth/oauth/<provider>/callback`
