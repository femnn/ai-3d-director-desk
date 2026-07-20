# 导演台 JSON 生成指南（供其他 AI 使用）

本文档定义 `apply_scene_script` 布景 JSON 和独立角色 JSON。生成结果必须是合法 JSON，不能包含 JavaScript、注释、Markdown 代码围栏或未定义字段。

## 可直接交给 AI 的指令

```text
你是 AI 影视导演台的布景规划器。请把我的场景描述转换为一个可被
apply_scene_script 直接导入的 JSON 对象。

硬性规则：
1. 只输出 JSON，不输出 Markdown、解释或注释。
2. 根对象使用 reset、scenePlan、characters、proceduralObjects、groups、props、cameras、directorView、activeCameraId。
3. 坐标单位为米，Y 轴向上；rotation 使用弧度；比例必须是 [x,y,z]。
4. 汽车、火车、飞机、建筑、龙等可识别整体必须使用 proceduralObjects；groups 只用于简单手工组合。
5. 子部件 dimensions 是可见尺寸，position/rotation 是相对父级的局部坐标；通常保持 transform.scale=[1,1,1]。
6. 门、翅膀、车轮等旋转部件必须设置 actionProfile.pivot.localPosition，并把动画放在该子部件上。
7. 整体移动动画放在 proceduralObjects[].directorAnimation；局部动作放在对应 componentTree[] 部件。
8. 动画 duration 只能是 5、10 或 15；默认 loop=true。
9. 路径至少提供 2 个点；飞行和转弯使用 curve，机械直线运动使用 linear。
10. characters 必须明确 name、bodyType、color、pose/poseControls、position、rotation、scale 和 action。
11. 相对站位要留出人体和道具尺寸，避免角色、桌椅、墙体互相穿插。
12. 至少创建一个 cameras 条目，并提供 directorView；position 与 lookAt 必须能完整看见所有主体。
13. 如需使用导演台已注册的高精度程序化模型，先调用 list_procedural_factories，再在 props 中使用 factoryId 和 factoryParameters；不得输出 JavaScript。

生成前先在 scenePlan 中写清楚意图、角色关系、环境、组合物体及动作；再输出具体部件。
输出前自检：层级正确、ID 唯一、父子局部坐标合理、路径点数量足够、机位能看见主体。
```

## 坐标与基础体

- 坐标：`[x, y, z]`，Y 轴向上，常用人物脚底高度为 `y=0`。
- 旋转：弧度，90 度为 `1.5708`，180 度为 `3.1416`，一圈为 `6.2832`。
- 基础体：`box`、`rounded-box`、`sphere`、`ellipsoid`、`hemisphere`、`capsule`、`cylinder`、`pipe`、`disc`、`plane`、`plane-card`、`wedge`、`torus`、`cone`、`pyramid`。
- 角色体型：`mannequin`、`female`、`broad`、`muscular`、`slim`、`teen`、`child`、`chibi`。
- 角色动作：`still`、`idle`、`sit`、`drink-tea`、`talk`、`walk`、`run`、`turn`、`look`、`wave`、`bow`、`think`、`reach`、`push`、`fight`、`dance`、`light-dance`、`phone`。其中 `light-dance` 是带交叉步、抬腿、连续蹲跳、摆臂和过头动作的 15 秒编舞，不能压缩为 5 秒。

## 场景 JSON 示例

```json
{
  "reset": true,
  "characters": [],
  "proceduralObjects": [
    {
      "targetName": "红色轿车",
      "directorPlacement": { "position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1] },
      "directorAnimation": {
        "duration": 15,
        "loop": true,
        "enabled": true,
        "playbackMode": "normal",
        "path": {
          "type": "linear",
          "closed": true,
          "orientToPath": false,
          "points": [[-3, 0, 0], [3, 0, 0]]
        }
      },
      "materials": [
        { "id": "paint", "baseColor": "#d83b32", "roughness": 0.26, "metalness": 0.48 },
        { "id": "tire", "baseColor": "#24282d", "roughness": 0.88, "metalness": 0.02 }
      ],
      "componentTree": [
        {
          "id": "body",
          "name": "车身",
          "primitive": "box",
          "parent": null,
          "material": "paint",
          "dimensions": { "width": 4.2, "height": 0.8, "depth": 1.8 },
          "transform": { "position": [0, 0.85, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1] },
          "geometryDescriptor": { "edgeTreatment": { "bevelRadius": 0.14 } }
        },
        {
          "id": "front-wheel",
          "name": "前轮",
          "primitive": "torus",
          "parent": null,
          "material": "tire",
          "dimensions": { "width": 0.78, "height": 0.78, "depth": 0.28 },
          "transform": { "position": [1.3, 0.48, 0.94], "rotation": [0, 0, 0], "scale": [1, 1, 1] },
          "mirror": { "axis": "z" }
        }
      ]
    }
  ],
  "cameras": [
    { "id": "cam-car", "name": "车辆展示机位", "position": [7, 4, 9], "lookAt": [0, 1, 0], "fov": 45 }
  ],
  "directorView": { "position": [7, 4, 9], "lookAt": [0, 1, 0], "fov": 45 },
  "activeCameraId": "cam-car"
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

- 以上 `normal / recording-sync / camera-driven` 仅用于兼容旧的单物体动画字段。新的 AI 联动动画应使用文末统一动画序列及 `manual / recording / camera-motion`。
- 同时设置 `keyframes` 和 `path` 时，路径负责位置，关键帧继续控制旋转和缩放。

## 已注册程序化模型工厂

程序化模型工厂适合保存 Codex 已生成并验证的复杂 Three.js 模型。它与 `proceduralObjects` 的区别是：前者保持专用模型代码和连续形变，后者保持由基础体组成的可展开部件树。

```json
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
```

当前 `crimson-transformer` 支持汽车到机器人的连续变形。详细扩展方式见 [Img2ThreeJS 程序化模型工厂接入指南](IMG2THREEJS_FACTORY_INTEGRATION.md)。未知 `factoryId` 会被拒绝，JSON 中的代码字段不会被执行。

`train-station-car-chase` 是完整场景动画工厂，包含火车站、四节列车、追车飞跃和确定性爆炸。直接导入 [`train-station-car-chase-15s.json`](../examples/scene-scripts/train-station-car-chase-15s.json) 即可使用。它不依赖随机刚体物理，因此电脑监看、手机画面和录像结果可以保持一致。

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

1. 文件方式：在 AI 布景面板点击“导入并执行”，可选择完整布景、`storyai-character` 独立角色、`storyai-character-animation` 角色动画包或 `storyai-animation-sequence` 动画 JSON。完整布景会替换当前导演台；角色动画包只追加角色和动画，不修改已有场景、道具和机位。动画序列会先预览摘要并要求确认。
2. 文本方式：将场景 JSON 粘贴到 AI 布景面板后点击“执行布景”，或调用 `apply_scene_script`。
3. 调用 `screenshot` 获取导演视角截图。
4. 对照原始意图检查轮廓、尺寸、穿插、朝向和机位构图。
5. 使用 `update_prop`、`update_character`、`set_camera_view` 修正，不要每次重置整个场景。
6. 调用 `export_scene_script` 保存可复用命令；单个角色使用 `export_character`。

## 从参考图生成更真实的程序化道具

导演台兼容 [Three.js Object Sculptor](https://github.com/vinhhien112/Three.js-Object-Sculptor-Codex-Plugin) 的安全 `ObjectSculptSpec` 子集。它适合把一张主体清晰的物体参考图拆成可编辑部件树，而不是生成一个无法修改的整体网格。

在 AI 布景面板选择“导入 JSON 并执行”，或调用 `import_object_sculpt_spec`，可直接导入包含以下字段的 JSON：

- `targetName`：道具名称。
- `materials[]`：`id`、`baseColor`、`roughness`、`metalness`、`opacity`。
- `componentTree[]`：每个部件的 `id`、`name`、`parent`、`primitive`、`dimensions`、`transform`、`material`。
- `actionProfile.pivot.localPosition`：门轴、轮轴、翼根等局部旋转轴。
- `directorPlacement`：整个道具导入导演台时的位置、旋转和缩放。
- `directorAnimation`：整个汽车、火车、飞机或其他总成的 5 / 10 / 15 秒运动。
- `repeat` / `mirror`：阵列和镜像车轮、车窗、栏杆、灯具等重复部件。

推荐直接把下面的指令和物体参考图交给 Codex：

```text
请根据我附加的物体参考图生成一个可导入 AI 影视导演台的 ObjectSculptSpec JSON。

要求：
1. 只输出合法 JSON，不输出 Markdown、解释、注释或 JavaScript。
2. 顶层必须包含 targetName、materials、componentTree，可选 directorPlacement、directorAnimation。
3. 坐标单位按米估算，Y 轴向上，rotation 使用弧度。
4. 先匹配主体轮廓、长宽高比例、负空间和最有辨识度的部件，再添加小细节。
5. 每个部件必须有唯一 id；parent 必须引用已有部件 id 或为 null；所有变换均为相对父级的局部坐标。
6. primitive 只能使用 box、sphere、ellipsoid、cylinder、cone、capsule、torus、plane-card、tube、lathe、extrude、curve-sweep、instanced-cluster。
7. box 需要圆角时，在 geometryDescriptor.edgeTreatment.bevelRadius 中填写大于 0 的值。
8. 材质必须明确 baseColor、roughness、metalness；玻璃或半透明部件再填写 opacity。
9. 门、轮、把手、翅膀等可动部件必须单独建节点，并设置 actionProfile.pivot.localPosition。
10. 不要把整件物体写成一个部件；宏观主体、结构部件和高辨识度细节要分层。
11. 重复部件优先使用 repeat 和 mirror；componentTree 最多 500 个部件，避免无意义高密度小球。
12. 输出前检查 ID 唯一、父级存在、没有循环层级、比例合理、部件没有明显穿插。
```

导入后，每个部件都会转换为导演台原生对象。画面中点击任意部件默认选中整个总成，可以整体移动、缩放、删除和添加路径动画；在对象树展开总成后仍可选择单独部件，调整尺寸、颜色、材质、父子层级与旋转轴。`tube`、`lathe`、`extrude` 等当前没有完全对应的基础体时会使用安全近似并返回提示，不会执行生成代码。

新版程序化部件使用独立 `geometrySize` 保存可见尺寸，不再把车身尺寸写进会传递给子节点的 `transform.scale`。AI 在 ObjectSculptSpec 中继续填写 `dimensions` 即可，导演台导入时会自动转换。

示例文件：[`examples/object-sculpt-specs/cinema-camera-rig.object-sculpt.json`](../examples/object-sculpt-specs/cinema-camera-rig.object-sculpt.json)。

大型场景验收文件：[`examples/scene-scripts/procedural-vehicle-yard.json`](../examples/scene-scripts/procedural-vehicle-yard.json)。该文件在一个 `apply_scene_script` 中同时生成可整体移动的轿车、带循环路径动画的旅客列车、展示机位和导演视角。

## AI 动画序列

复杂舞蹈、多人打斗和车辆事件使用 `storyai-animation-sequence` JSON，不要把参与对象分别设置为无关的旧动画。

- `duration` 只使用 `5 / 10 / 15`。
- `playbackMode` 只使用 `manual / recording / camera-motion`。
- `loop` 是独立开关，不是播放模式。
- `bindings` 使用语义别名绑定对象，同时填写 `objectId` 和 `objectName`。
- 角色轨使用 `type: "character"`，可引用内置 `actionId` 或 `motionClipId`。
- 物体轨使用 `type: "object"`；组合根负责整体运动，子部件只写局部坐标。
- 外部角色动作帧可包含 `controls`、`rootOffset` 和 `rootRotation`。
- 导入前调用 `review_animation_sequence`，修复缺失绑定、超出时长和突然大位移。
- `manual` 手动播放默认填写 `"loop": true`；只有确实需要停在最后一帧时才填写 `false`。

只包含角色及其动作的舞蹈、对打、表演使用增量角色动画包，不要填写 `reset`、场景、道具或机位：

```json
{
  "format": "storyai-character-animation",
  "version": 1,
  "name": "双人对打",
  "characters": [
    { "id": "fighter_a", "name": "格斗者A", "position": [-1.4, 0, 0] },
    { "id": "fighter_b", "name": "格斗者B", "position": [1.4, 0, 0] }
  ],
  "animationSequences": [
    {
      "format": "storyai-animation-sequence",
      "version": 1,
      "sequence": {
        "id": "fight_sequence",
        "name": "双人对打",
        "duration": 10,
        "playbackMode": "manual",
        "loop": true,
        "enabled": true,
        "cameraId": null,
        "bindings": [],
        "tracks": []
      }
    }
  ]
}
```

完整场景、车辆特技和包含环境道具的事件继续使用 `apply_scene_script`，文件导入时会清空并替换当前布景。只给已有对象增加动画时使用独立 `storyai-animation-sequence`，对象绑定必须能在当前场景中找到。

Agent 工具：`create_animation_sequence`、`update_animation_sequence`、`delete_animation_sequence`、`play_animation_sequence`、`pause_animation_sequence`、`scrub_animation_sequence`、`export_animation_sequence`、`import_animation_sequence`、`import_character_animation`、`review_animation_sequence`。

验收示例：[`AI 15 秒舞蹈`](../examples/animation-sequences/ai-dance-15s.json)、[`10 秒双人打斗`](../examples/animation-sequences/two-person-fight-10s.json)、[`汽车飞跃火车并部件抛飞`](../examples/animation-sequences/car-jump-train-breakup-10s.json)。
