# Onmyoji Yuhun

阴阳师御魂规划与阵容分析网站。

## 本地开发

```bash
npm ci
npm run dev
```

生产构建：

```bash
npm run check
```

网站通过 `https://api.fireschain.org` 读取公开场景和阵容数据。用户上传的御魂快照默认只在浏览器本地处理，不会随网站代码发布。

式神和御魂图片由 `https://onmyoji-assets.fireschain.org` 的 R2 资源域名提供；可用 `VITE_ASSET_BASE_URL` 覆盖该地址。

## 本地诊断双码覆盖

使用私有诊断导出中的快照、规则和阵容计算结果，对比不同允许影响比例：

```bash
node --import tsx scripts/diagnose-plan-impact.ts /path/to/diagnostics.private.json 500 0 1 3 5
```

`500` 是预期空位，后续数字是允许影响百分比。脚本只在本地计算并输出汇总，
校验强化规则等严格保护项、去重后的影响额度、历史弃置保护和每码 60 组上限。
不要提交诊断文件或账号派生输出。

## License

代码以 MIT License 发布，第三方素材和数据遵循各自来源的许可说明。
