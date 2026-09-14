# Agent 配置目录

Agent 模式的接口配置存在这里的 `agent.json`，界面上的「模型设置」会读写它。

内容包含所选接口、接口地址、模型名与 **API Key**。这个文件已在 `.gitignore` 中排除，
**不会被提交到版本库**。

密钥由本地服务在转发请求时使用，浏览器不会拿到明文，面板上也只显示末四位。

删除该文件即回到默认配置（DeepSeek，未填密钥）。

支持的接口：DeepSeek、OpenAI、Kimi、通义千问、智谱 GLM、本地 Ollama，
以及任何 OpenAI 兼容端点。
