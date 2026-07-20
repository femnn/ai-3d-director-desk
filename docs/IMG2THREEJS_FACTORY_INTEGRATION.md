# Img2ThreeJS 程序化模型工厂接入指南

导演台支持两条 AI 快速造物路径：

1. `ObjectSculptSpec`：用基础体生成可展开、可逐部件编辑的组合道具，适合 Blockout、门窗、车轮和机械层级。
2. 程序化模型工厂：把经过人工或 Codex 审查的 Three.js 造型代码注册到导演台，适合汽车、机器人、复杂机械和连续变形效果。

第二条路径已接入本机项目 `/Users/kangkang/Documents/3d项目/transforming-car-robot`。源项目保持独立；导演台只包含经审查的模型实现和 MIT 许可说明。

当前工厂：

- `crimson-transformer`：红色跑车连续变形为人形机甲。
- `train-station-car-chase`：15 秒火车驶出车站、汽车追赶、跨轨飞跃并在另一侧爆炸的完整场景动画。

## 为什么不直接导入生成的 JavaScript

布景 JSON 可能来自任意 AI，不能允许它携带并执行 JavaScript。导演台使用白名单注册表：代码必须先放入 `src/editor/runtime/proceduralFactories/` 并经过构建和测试，布景 JSON 只能引用已注册的 `factoryId` 和有限参数。

因此：

- 工程 JSON、布景命令、电脑监看和手机预览都能稳定复现模型。
- 未注册的 ID 会被拒绝，不会退化为执行任意脚本。
- 一个程序化对象仍是导演台中的单一对象，可整体选择、移动、缩放、删除和添加通用物体动画。

## AI 布景命令

先调用 Agent 工具 `list_procedural_factories` 获取本机可用工厂，再在 `props[]` 中引用：

```json
{
  "reset": false,
  "props": [
    {
      "name": "赤曜变形机甲",
      "factoryId": "crimson-transformer",
      "factoryParameters": {
        "morph": 0,
        "autoTransform": true,
        "transformDuration": 10
      },
      "color": "#a62934",
      "position": [0, 0, 0],
      "rotation": [0, 0, 0],
      "scale": [0.82, 0.82, 0.82]
    }
  ]
}
```

参数：

- `morph`：`0` 为汽车，`1` 为机器人，中间值为变形过程。
- `autoTransform`：开启后自动在汽车和机器人之间往返变形。
- `transformDuration`：一次完整往返时长，只能为 `5`、`10` 或 `15` 秒。
- `color`：车漆和机甲装甲主色。

完整示例：[`crimson-transformer-showcase.json`](../examples/scene-scripts/crimson-transformer-showcase.json)。

完整追车场景：[`train-station-car-chase-15s.json`](../examples/scene-scripts/train-station-car-chase-15s.json)。该场景提供站台追车全景、汽车飞跃侧拍和爆炸近景三个机位。`time` 可在暂停时定位到 0 至 15 秒，`autoPlay` 控制循环播放，`duration` 控制 5 / 10 / 15 秒压缩播放。

## 让 Codex 注册新的 Img2ThreeJS 结果

把下面的指令交给 Codex，并附上生成项目目录：

```text
请把这个 Img2ThreeJS 项目中的程序化 Three.js 模型接入 AI 影视导演台。
不要修改源项目。把模型生成函数移植到
src/editor/runtime/proceduralFactories/，注册一个稳定且唯一的 factoryId。
只暴露颜色、形态、速度等有限可序列化参数；禁止从布景 JSON 执行代码。
接入 SceneRoot，使导演视角、机位监看、手机预览和录像使用同一个模型。
补充 add_prop/apply_scene_script、工程与布景命令导入导出、属性面板、测试、
第三方许可和可直接导入的示例 JSON。最后真实运行并截图检查非黑屏、构图完整、
对象可整体选中移动，导出后重新导入仍能恢复。
```

每个新工厂至少需要：

1. 创建函数返回一个 `THREE.Group`，根节点原点放在物体合理的地面/运动基准处。
2. 所有动态零件使用根节点下的局部坐标；不要让多个 Canvas 各自维护不一致的模型状态。
3. 在 `proceduralFactoryRegistry.ts` 注册 ID、参数默认值、范围和允许值。
4. 在 `ProceduralFactoryModel.tsx` 添加渲染分支和资源释放逻辑。
5. 为几何结构、参数规范化、AI JSON 往返和实际 Canvas 渲染补测试。
6. 保留来源项目许可，不复制未授权资产。

## 选择哪条路径

- 需要 AI 快速拼装、逐部件调整、镜像和阵列：使用 `ObjectSculptSpec`。
- 需要更精细轮廓、特殊材质、连续机械变形：注册程序化模型工厂。
- 已有可靠 GLB/FBX：直接导入模型；带骨骼动画的 GLB 优先使用模型自身动画。

程序化模型工厂不是通用文字生成 3D 服务。它把 Codex 已生成并验证的造型能力变成导演台可安全复用的本地资产。
