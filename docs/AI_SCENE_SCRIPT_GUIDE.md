# 导演台 JSON 生成指南（供其他 AI 使用）

本文档定义 `apply_scene_script` 布景 JSON 和独立角色 JSON。生成结果必须是合法 JSON，不能包含 JavaScript、注释、Markdown 代码围栏或未定义字段。

## 可直接交给 AI 的指令

```text
你是 AI 影视导演台的布景规划器。请把我的场景描述转换为一个可被
apply_scene_script 直接导入的 JSON 对象。

硬性规则：
1. 只输出 JSON，不输出 Markdown、解释或注释。
2. 根对象使用 reset、scenePlan、characters、groups、props、cameras、activeCameraId。
3. 坐标单位为米，Y 轴向上；rotation 使用弧度；比例必须是 [x,y,z]。
4. 复杂道具必须使用 groups[].children 的部件树，不要输出互不关联的散乱几何体。
5. 子部件 position/rotation/scale 是相对父级的局部坐标。
6. 门、翅膀、车轮等旋转部件必须设置 pivot，并把动画放在该子部件上。
7. 整体移动动画放在最外层 group；局部动作放在对应 child。
8. 动画 duration 只能是 5、10 或 15；默认 loop=true。
9. 路径至少提供 2 个点；飞行和转弯使用 curve，机械直线运动使用 linear。
10. characters 必须明确 name、bodyType、color、pose/poseControls、position、rotation、scale 和 action。
11. 相对站位要留出人体和道具尺寸，避免角色、桌椅、墙体互相穿插。
12. 至少创建一个 cameras 条目，position 与 lookAt 必须构成可见构图。

生成前先在 scenePlan 中写清楚意图、角色关系、环境、组合物体及动作；再输出具体部件。
输出前自检：层级正确、ID 唯一、父子局部坐标合理、路径点数量足够、机位能看见主体。
```

## 坐标与基础体

- 坐标：`[x, y, z]`，Y 轴向上，常用人物脚底高度为 `y=0`。
- 旋转：弧度，90 度为 `1.5708`，180 度为 `3.1416`，一圈为 `6.2832`。
- 基础体：`box`、`rounded-box`、`sphere`、`hemisphere`、`capsule`、`cylinder`、`pipe`、`disc`、`plane`、`wedge`、`torus`、`cone`、`pyramid`。
- 角色体型：`mannequin`、`female`、`broad`、`muscular`、`slim`、`teen`、`child`、`chibi`。
- 角色动作：`still`、`idle`、`sit`、`drink-tea`、`talk`、`walk`、`run`、`turn`、`look`、`wave`、`bow`、`think`、`reach`、`push`、`fight`、`dance`、`light-dance`、`phone`。其中 `light-dance` 是带踏步、弹跳、上举和指向动作的五秒轻快舞编排。

## 场景 JSON 示例

```json
{
  "reset": true,
  "scenePlan": {
    "intent": "一列火车从画面左侧驶向右侧",
    "roles": [],
    "environment": "简化站台",
    "composition": "三分构图，机位正侧面观察",
    "assemblies": [
      { "name": "火车", "parts": ["车身", "车轮"], "motion": "整体直线移动，车轮循环旋转" }
    ]
  },
  "characters": [],
  "groups": [
    {
      "id": "train",
      "kind": "group",
      "name": "火车",
      "position": [-4, 0.8, 0],
      "rotation": [0, 0, 0],
      "scale": [1, 1, 1],
      "animation": {
        "duration": 10,
        "loop": true,
        "enabled": true,
        "playbackMode": "normal",
        "path": {
          "type": "linear",
          "closed": false,
          "orientToPath": false,
          "points": [[-4, 0.8, 0], [4, 0.8, 0]]
        }
      },
      "children": [
        {
          "id": "train_body",
          "name": "车身",
          "geometryType": "rounded-box",
          "position": [0, 0, 0],
          "rotation": [0, 0, 0],
          "scale": [3, 1, 1],
          "color": "#B53A32"
        },
        {
          "id": "train_wheel",
          "name": "车轮",
          "geometryType": "disc",
          "position": [-1, -0.65, 0.55],
          "rotation": [0, 0, 0],
          "scale": [0.4, 0.4, 0.2],
          "color": "#20252C",
          "repeat": { "count": 3, "offset": [1, 0, 0] },
          "mirror": { "axis": "z" },
          "animation": {
            "duration": 5,
            "loop": true,
            "enabled": true,
            "playbackMode": "normal",
            "keyframes": [
              { "time": 0, "rotation": [0, 0, 0] },
              { "time": 5, "rotation": [6.2832, 0, 0] }
            ]
          }
        }
      ]
    }
  ],
  "props": [],
  "cameras": [
    { "id": "cam_train", "name": "火车侧面机位", "position": [0, 2.3, 8], "lookAt": [0, 1, 0], "fov": 42 }
  ],
  "activeCameraId": "cam_train"
}
```

## 动画字段

`animation` 可用于组合、基础体和导入模型：

```json
{
  "duration": 5,
  "loop": true,
  "enabled": true,
  "playbackMode": "normal",
  "cameraId": null,
  "keyframes": [
    { "time": 0, "position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1] },
    { "time": 5, "position": [2, 0, 0], "rotation": [0, 1.5708, 0], "scale": [1, 1, 1] }
  ],
  "path": {
    "type": "curve",
    "closed": true,
    "orientToPath": true,
    "points": [[0, 2, 0], [3, 3, 1], [0, 4, 4], [-3, 3, 1]]
  }
}
```

- `normal`：进入场景后循环播放。
- `recording-sync`：录制开始时从 0 秒推进。
- `camera-driven`：录制时关联机位移动才推进。
- 同时设置 `keyframes` 和 `path` 时，路径负责位置，关键帧继续控制旋转和缩放。

## 角色 JSON

完整布景中的 `characters[]` 与独立 `.character.json` 使用同一个角色结构：

```json
{
  "format": "storyai-character",
  "version": 1,
  "character": {
    "name": "女主",
    "bodyType": "female",
    "color": "#D94C73",
    "pose": "stand",
    "poseControls": {},
    "position": [0, 0, 0],
    "rotation": [0, 0, 0],
    "scale": [1, 1, 1],
    "action": {
      "id": "talk",
      "duration": 5,
      "playbackMode": "normal",
      "enabled": true,
      "source": "built-in"
    }
  }
}
```

导演台导出的角色文件还可能包含：

- `poseControls`：骨骼编辑后的全部控制值。
- `motionClip`：视频动作的逐帧 `controls`，导入后自动生成新动作 ID 并绑定到新角色。
- `asset`：角色模型文件名、URL、来源和动画标记。跨电脑使用时应使用可持久化 URL 或完整工程 JSON，不能依赖临时 `blob:` URL。

## 导入与修正流程

1. 文件方式：在 AI 布景面板点击“导入并执行”，可直接选择完整布景 JSON 或 `storyai-character` 独立角色 JSON，选择后立即创建并播放普通循环动作。
2. 文本方式：将场景 JSON 粘贴到 AI 布景面板后点击“执行布景”，或调用 `apply_scene_script`。
3. 调用 `screenshot` 获取导演视角截图。
4. 对照原始意图检查轮廓、尺寸、穿插、朝向和机位构图。
5. 使用 `update_prop`、`update_character`、`set_camera_view` 修正，不要每次重置整个场景。
6. 调用 `export_scene_script` 保存可复用命令；单个角色使用 `export_character`。
