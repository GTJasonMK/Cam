-- Agent 运行时环境字段：native（直接执行）或 wsl（Windows 上通过 WSL 代理执行）
ALTER TABLE agent_definitions ADD COLUMN runtime TEXT NOT NULL DEFAULT 'native';
