# 3D导演台 Demo

一个基于 React、Vite、Three.js 和 React Three Fiber 的 3D 分镜导演台 Demo。它面向轻量级预演和镜头规划场景，支持在浏览器里搭建角色、机位、场景和全景背景，并快速记录镜头。

## 功能概览

- 导演视角 / 机位视角切换
- 角色、群演、基础几何体和机位快速添加
- 本地 FBX / OBJ 模型导入
- 全景图导入与背景调节
- 机位拍摄、截图记录和基础镜头管理
- 视口比例框、九宫格、平移 / 旋转 / 缩放控制
- 本地场景状态持久化

## 技术栈

- React 18
- Vite 6
- TypeScript
- Three.js
- @react-three/fiber
- @react-three/drei
- Zustand
- Vitest

## 本地开发

```bash
npm install
npm run dev
```

默认开发地址：

```text
http://127.0.0.1:4173/
```

## 构建

```bash
npm run build
```

## 测试

```bash
npm test
```

## 开源说明

- 本仓库以源码演示为主，适合继续扩展为更完整的 3D 导演工具。
- 当前版本保留内置角色能力，并支持通过界面导入本地模型与全景图。
- 若你基于本项目继续发布，请自行确认新增模型、贴图和场景素材的分发许可。

## 已知情况

- 当前生产构建可通过。
- 当前 Vitest 测试集中仍有少量失败用例，后续可继续稳定化。

## License

MIT
