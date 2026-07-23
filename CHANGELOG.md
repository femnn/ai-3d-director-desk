# 更新日志 / Changelog

## v0.9.0 - 2026-07-23

这是导演台首次覆盖完整 AI 预演流程的版本：从 AI 布景、角色与物体动画，到多手机虚拟摄影和 MP4 成片导出。

### 新功能

- 多台手机扫码加入并分别控制独立机位，机位不足时自动创建。
- 手机与电脑机位监看同步，支持移动、朝向、高度、焦段和 5 / 10 / 15 秒镜头录制。
- 角色、组合道具和子部件共用统一动画序列，支持循环播放和确定性录像。
- 支持层级组合、局部坐标、旋转轴、关键帧、路径动画和可编辑程序化道具。
- 支持 ObjectSculptSpec 和白名单 3D 模型工厂，可创建汽车、火车、飞机、建筑及变形模型。
- 增加列车驶出车站、汽车追赶飞跃爆炸和公园外星人劫持等完整场景动画示例。
- 集成 GNM 本地面部动画，提供独立面捕演员、摄像头表演录制和文字口型动画。
- 支持多个面捕演员分别绑定、循环播放和同步到手机预览及最终录像。
- Agent 可通过白名单 JSON 创建和修改角色、道具、机位、场景动画及面部动画。

### 改进

- 优化长时间镜头录制，提升 5 / 10 / 15 秒快速移动镜头的流畅度和完整性。
- 大型场景采用分阶段同步，避免手机长期停留在“正在分配机位”界面。
- 修复手机预览与电脑监看画面不一致、镜像、动画静止及场景更新不同步问题。
- 修复多段短视频、录像提前结束、帧数异常和导出 MP4 失败问题。
- 修复面捕演员头部反复缩放、比例异常、多角色动画串绑及文字输入无法粘贴问题。
- 完善完整工程、布景命令、角色、姿势、动画和导入模型的保存与恢复。
- 修复跨平台依赖锁定和桌面打包配置，支持生成 macOS ARM64 与 Windows x64 安装包。

## English

Version 0.9.0 completes the core AI previs workflow, from agent-assisted scene building and animation to multi-phone virtual cinematography and MP4 delivery.

### Highlights

- Independent virtual cameras for multiple phones with automatic camera assignment.
- Synchronized phone and desktop monitoring with 5, 10, and 15-second camera recording.
- Unified animation sequences for characters, grouped props, and child parts.
- Hierarchical procedural props, ObjectSculptSpec import, and allowlisted 3D model factories.
- Deterministic train chase, vehicle explosion, and alien abduction scene examples.
- Local GNM facial animation with dedicated actors, webcam capture, and text-driven lip sync.
- More reliable large-scene synchronization and smoother complete MP4 recording.
- Project, scene-command, character, pose, animation, and imported-asset persistence.
- Fixed cross-platform dependency locking and desktop packaging for macOS ARM64 and Windows x64.
