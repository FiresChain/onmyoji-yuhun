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

## License

代码以 MIT License 发布，第三方素材和数据遵循各自来源的许可说明。
