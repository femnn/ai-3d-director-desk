# AI 影视 3D 导演台

一个本地优先的 AI 影视预演与虚拟摄影工具。可以在电脑上快速搭建 3D 布景，让多台手机分别控制不同机位，并把机位监看中的实时画面直接录制为流畅视频。

本项目基于 [storyai-3d-director-desk](https://github.com/jiguang132/storyai-3d-director-desk) 持续改造，保留 MIT License。

## 特色功能

- **手机就是虚拟摄影机**：扫码加入、摇杆移动、滑动控制朝向、升降和变焦；每台手机独占自己的机位。
- **横屏全屏操控**：进入全屏时优先锁定系统横屏，不支持方向锁定的浏览器会自动使用横屏布局。
- **机位监看与视频录制**：手机和电脑看到同一实时机位画面，支持 5 / 10 / 15 秒轨迹录制与 MP4 导出。
- **快速制作角色动画**：内置循环动作、镜头移动驱动动作、视频动作提取、图片姿势提取及 AnimoFlow 文字动作入口。
- **AI 快速布景**：Agent 通过白名单 JSON 命令创建角色、道具、站位和机位，不执行任意脚本。
- **一键保存与恢复**：支持完整工程 JSON、可复用布景命令、导入模型、角色姿势和摄像机动画。
- **完整导演台**：角色、群演、20 种姿势、骨骼编辑、基础几何体、模型导入、全景背景、对象树与显式删除。

## 快速开始

### macOS 启动器

双击项目目录中的 `启动3D导演台.command`。启动器会运行本地服务并自动打开导演台页面，终端窗口不要关闭。

### 源码运行

```bash
npm install
npm run dev
```

电脑打开终端显示的 `Director desk` 地址。手机与电脑连接同一网络后，扫描导演台中的二维码即可加入。

### 桌面程序

```bash
npm run package:mac
npm run package:win
```

Windows 提供安装版和便携版。若 Windows 无法启动，请查看：

```text
%APPDATA%\AI影视导演台\logs\director-desk.log
```

## 基本流程

1. 在电脑导演台添加角色、道具和机位，或在 AI 布景面板导入结构化命令。
2. 手机扫描二维码加入。多人加入时每台手机会绑定一个独立机位，机位不足时自动创建。
3. 手机选择自己的机位，使用左侧摇杆移动，拖动画面改变镜头方向，并调整高度和焦段。
4. 选择 5、10 或 15 秒录制。导演台会保存摄像机轨迹及对应的实时机位视频。
5. 在摄像机动画列表回放、删除轨迹或导出 MP4。
6. 使用“导出工程”保存全部资产，或导出“布景命令”供 Agent 和其他工程快速恢复。

完整操作说明见 [使用指南](docs/USER_GUIDE.md)。

## Agent 布景接口

第一版使用固定白名单工具：

- `get_scene`
- `apply_scene_script`
- `add_character` / `update_character`
- `add_camera` / `set_camera_view`
- `add_prop` / `delete_object`
- `capture_shot` / `screenshot`
- `export_scene_script` / `import_scene_script`
- `record_camera_animation` / `play_camera_animation`

示例：

```json
{
  "reset": true,
  "characters": [
    {
      "name": "女主",
      "type": "builtIn",
      "pose": "pointing",
      "position": [0, 0, 0],
      "rotationY": 0
    }
  ],
  "props": [
    {
      "type": "box",
      "position": [1, 0.5, -1],
      "scale": [2, 1, 1]
    }
  ],
  "camera": {
    "name": "近景推镜",
    "position": [0, 1.6, 4],
    "lookAt": [0, 1.3, 0],
    "fov": 35
  }
}
```

## 技术栈

- React 18 + TypeScript + Vite
- Three.js + React Three Fiber + Drei
- Zustand 场景状态
- WebSocket 多手机实时控制
- MediaRecorder + FFmpeg MP4 封装
- Electron + electron-builder
- Vitest

## 开发与验证

```bash
npm test
npm run build
```

GitHub Actions 中的桌面构建会分别在真实 Windows 和 macOS runner 上生成安装产物。

## 隐私与数据

- 导演台、手机控制和 Agent 桥均可在本地网络运行。
- 工程和布景命令由用户主动导出，不自动上传。
- 手机控制状态通过当前导演台的 WebSocket 会话传输。
- 使用外部 AnimoFlow 服务时，其动作生成请求遵循对应服务的部署和隐私设置。

## License

[MIT](LICENSE)
