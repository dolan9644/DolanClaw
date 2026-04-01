# 贡献指南

感谢你有兴趣为 DolanClaw 做出贡献！

## 如何贡献

### 报告 Bug

1. 在 [Issues](../../issues) 页面搜索是否已有相同问题
2. 如果没有，创建新 Issue，请包含：
   - 复现步骤
   - 预期行为 vs 实际行为
   - 浏览器 + 操作系统信息
   - 如有可能，附上截图

### 提交代码

1. Fork 本仓库
2. 创建新分支: `git checkout -b feature/你的功能名`
3. 提交更改: `git commit -m '添加 XXX 功能'`
4. 推送分支: `git push origin feature/你的功能名`
5. 发起 Pull Request

### 代码规范

- **TypeScript** — 严格模式，所有类型必须显式声明
- **CSS** — 使用项目 CSS 变量，不要硬编码颜色/尺寸
- **图标** — 禁止使用 emoji，使用 `src/components/Icons.tsx` 中的 SVG 组件
- **提交信息** — 使用中文，简明描述改动内容

### 本地开发

```bash
# 安装依赖
bun install
cd web && npm install

# 启动开发环境
bun run src/entrypoints/web.ts --port 3000  # 后端
cd web && npm run dev                        # 前端

# 类型检查
cd web && npx tsc --noEmit
```

## 许可

提交代码即表示你同意将代码以 [Apache 2.0](LICENSE) 许可证发布。
