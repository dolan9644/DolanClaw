---
name: Docker 部署
description: 使用 Docker 构建和部署项目
trigger: auto
---

当用户要求部署时，执行以下步骤：
1. 检查项目根目录是否有 Dockerfile
2. 运行 docker build -t project:latest .
3. 运行 docker run -d -p 3000:3000 project:latest
4. 验证容器是否正常运行
