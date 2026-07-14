import { Boxes, MapPinPlus, Play, Trash2 } from "lucide-react";
import {
  InspectorAxisGroup,
  InspectorColorField,
  InspectorPanel,
  InspectorRangeNumberField,
  InspectorSection,
  InspectorSelectField,
  InspectorTextField,
} from "./InspectorControls";
import { useDirectorStore } from "../store/directorStore";
import type { ObjectAnimationTrack } from "../schema/directorProject";

function replaceAxis(tuple: [number, number, number], axis: 0 | 1 | 2, value: number): [number, number, number] {
  return tuple.map((item, index) => (index === axis ? value : item)) as [number, number, number];
}

export function PropPanel() {
  const objects = useDirectorStore((state) => state.project.objects);
  const cameras = useDirectorStore((state) => state.project.cameras);
  const selectedObjectIds = useDirectorStore((state) => state.selectedObjectIds);
  const prop = useDirectorStore((state) => {
    const selected = state.project.objects.find((item) => item.id === state.selectedObjectId);
    const selectedAsset = selected?.assetRefId
      ? state.project.assets.find((asset) => asset.id === selected.assetRefId)
      : undefined;

    if (!selected) return undefined;
    if (selected.kind === "prop" || selected.kind === "group") return selected;
    if (selectedAsset?.sourceType === "model") return selected;

    return undefined;
  });
  const updateObjectName = useDirectorStore((state) => state.updateObjectName);
  const updateObjectTransform = useDirectorStore((state) => state.updateObjectTransform);
  const updateUniformScale = useDirectorStore((state) => state.updateUniformScale);
  const updateObjectColor = useDirectorStore((state) => state.updateObjectColor);
  const updateObjectPivot = useDirectorStore((state) => state.updateObjectPivot);
  const setObjectParent = useDirectorStore((state) => state.setObjectParent);
  const groupObjects = useDirectorStore((state) => state.groupObjects);
  const setObjectAnimationTrack = useDirectorStore((state) => state.setObjectAnimationTrack);

  if (!prop) return null;

  const propColor = prop.color ?? "#d7e7ff";
  const animationTrack: ObjectAnimationTrack = prop.objectAnimationTrack ?? {
    id: `object_animation_${prop.id}`,
    name: `${prop.name}动画`,
    duration: 5,
    loop: true,
    enabled: false,
    playbackMode: "normal",
    cameraId: null,
    keyframes: [],
  };
  const updateAnimation = (patch: Partial<ObjectAnimationTrack>) =>
    setObjectAnimationTrack(prop.id, { ...animationTrack, ...patch, loop: true });
  const pivot = prop.pivot ?? [0, 0, 0];
  const parentOptions = objects.filter(
    (item) => item.id !== prop.id && item.kind !== "camera" && item.parentId !== prop.id
  );

  return (
    <InspectorPanel title="模型" ariaLabel="模型右侧属性面板" className="prop-inspector">
      <InspectorTextField label="名称" ariaLabel="模型名称" value={prop.name} onChange={(value) => updateObjectName(prop.id, value)} />
      <InspectorAxisGroup
        label="位置"
        axes={[
          {
            axis: "X",
            ariaLabel: "模型位置 X",
            value: prop.transform.position[0],
            onChange: (value) => updateObjectTransform(prop.id, { position: replaceAxis(prop.transform.position, 0, Number(value)) }),
          },
          {
            axis: "Y",
            ariaLabel: "模型位置 Y",
            value: prop.transform.position[1],
            onChange: (value) => updateObjectTransform(prop.id, { position: replaceAxis(prop.transform.position, 1, Number(value)) }),
          },
          {
            axis: "Z",
            ariaLabel: "模型位置 Z",
            value: prop.transform.position[2],
            onChange: (value) => updateObjectTransform(prop.id, { position: replaceAxis(prop.transform.position, 2, Number(value)) }),
          },
        ]}
      />
      <InspectorAxisGroup
        label="旋转轴"
        axes={([0, 1, 2] as const).map((axis) => ({
          axis: (["X", "Y", "Z"] as const)[axis],
          ariaLabel: `模型旋转轴 ${(["X", "Y", "Z"] as const)[axis]}`,
          value: pivot[axis],
          onChange: (value) => updateObjectPivot(prop.id, replaceAxis(pivot, axis, Number(value))),
        }))}
      />
      <InspectorSelectField
        label="父级对象"
        ariaLabel="模型父级对象"
        value={prop.parentId ?? ""}
        options={[
          { value: "", label: "无（场景顶层）" },
          ...parentOptions.map((item) => ({ value: item.id, label: item.name })),
        ]}
        onChange={(value) => setObjectParent(prop.id, value || null)}
      />
      <InspectorAxisGroup
        label="旋转"
        axes={[
          {
            axis: "X",
            ariaLabel: "模型旋转 X",
            value: prop.transform.rotation[0],
            onChange: (value) => updateObjectTransform(prop.id, { rotation: replaceAxis(prop.transform.rotation, 0, Number(value)) }),
          },
          {
            axis: "Y",
            ariaLabel: "模型旋转 Y",
            value: prop.transform.rotation[1],
            onChange: (value) => updateObjectTransform(prop.id, { rotation: replaceAxis(prop.transform.rotation, 1, Number(value)) }),
          },
          {
            axis: "Z",
            ariaLabel: "模型旋转 Z",
            value: prop.transform.rotation[2],
            onChange: (value) => updateObjectTransform(prop.id, { rotation: replaceAxis(prop.transform.rotation, 2, Number(value)) }),
          },
        ]}
      />
      <InspectorAxisGroup
        label="缩放"
        axes={[
          {
            axis: "X",
            ariaLabel: "模型缩放 X",
            step: "0.01",
            value: prop.transform.scale[0],
            onChange: (value) => updateObjectTransform(prop.id, { scale: replaceAxis(prop.transform.scale, 0, Number(value)) }),
          },
          {
            axis: "Y",
            ariaLabel: "模型缩放 Y",
            step: "0.01",
            value: prop.transform.scale[1],
            onChange: (value) => updateObjectTransform(prop.id, { scale: replaceAxis(prop.transform.scale, 1, Number(value)) }),
          },
          {
            axis: "Z",
            ariaLabel: "模型缩放 Z",
            step: "0.01",
            value: prop.transform.scale[2],
            onChange: (value) => updateObjectTransform(prop.id, { scale: replaceAxis(prop.transform.scale, 2, Number(value)) }),
          },
        ]}
      />
      <InspectorRangeNumberField
        label="统一缩放"
        rangeAriaLabel="模型统一缩放滑杆"
        numberAriaLabel="模型统一缩放"
        max="3"
        min="0.2"
        step="0.01"
        value={prop.transform.scale[0]}
        onValueChange={(value) => updateUniformScale(prop.id, Number(value))}
      />
      {prop.kind !== "group" ? <InspectorColorField
        label="颜色"
        colorAriaLabel="模型颜色"
        hexAriaLabel="模型颜色 HEX"
        value={propColor}
        onColorChange={(value) => updateObjectColor(prop.id, value)}
        onHexChange={(value) => updateObjectColor(prop.id, value)}
      /> : null}
      {selectedObjectIds.length > 1 ? (
        <div className="inspector-action-row">
          <button type="button" onClick={() => groupObjects(selectedObjectIds)}>
            <Boxes aria-hidden="true" size={14} />
            组合所选
          </button>
        </div>
      ) : null}
      <InspectorSection title="物体动画">
        <InspectorSelectField
          label="播放方式"
          ariaLabel="物体动画播放方式"
          value={animationTrack.playbackMode}
          options={[
            { value: "normal", label: "普通播放" },
            { value: "recording-sync", label: "录制同步" },
            { value: "camera-driven", label: "镜头驱动" },
          ]}
          onChange={(value) => updateAnimation({ playbackMode: value as ObjectAnimationTrack["playbackMode"] })}
        />
        {animationTrack.playbackMode !== "normal" ? (
          <InspectorSelectField
            label="关联机位"
            ariaLabel="物体动画关联机位"
            value={animationTrack.cameraId ?? ""}
            options={[
              { value: "", label: "当前录制机位" },
              ...cameras.map((camera) => ({ value: camera.id, label: camera.name })),
            ]}
            onChange={(value) => updateAnimation({ cameraId: value || null })}
          />
        ) : null}
        <InspectorSelectField
          label="循环时长"
          ariaLabel="物体动画循环时长"
          value={String(animationTrack.duration)}
          options={[5, 10, 15].map((duration) => ({ value: String(duration), label: `${duration}秒` }))}
          onChange={(value) => updateAnimation({ duration: Number(value) as 5 | 10 | 15 })}
        />
        <InspectorSelectField
          label="路径"
          ariaLabel="物体动画路径类型"
          value={animationTrack.path?.type ?? "none"}
          options={[
            { value: "none", label: "仅关键帧" },
            { value: "linear", label: "直线路径" },
            { value: "curve", label: "曲线路径" },
          ]}
          onChange={(value) =>
            updateAnimation({
              path:
                value === "none"
                  ? undefined
                  : {
                      type: value as "linear" | "curve",
                      closed: animationTrack.path?.closed ?? false,
                      orientToPath: animationTrack.path?.orientToPath ?? false,
                      points: animationTrack.path?.points ?? [prop.transform.position],
                    },
            })
          }
        />
        {animationTrack.path ? (
          <>
            <InspectorSelectField
              label="路径循环"
              ariaLabel="物体动画路径是否闭合"
              value={animationTrack.path.closed ? "closed" : "open"}
              options={[
                { value: "open", label: "开放路径" },
                { value: "closed", label: "闭合路径" },
              ]}
              onChange={(value) => updateAnimation({ path: { ...animationTrack.path!, closed: value === "closed" } })}
            />
            <InspectorSelectField
              label="移动朝向"
              ariaLabel="物体动画是否跟随路径朝向"
              value={animationTrack.path.orientToPath ? "follow" : "fixed"}
              options={[
                { value: "fixed", label: "保持原朝向" },
                { value: "follow", label: "跟随路径" },
              ]}
              onChange={(value) => updateAnimation({ path: { ...animationTrack.path!, orientToPath: value === "follow" } })}
            />
          </>
        ) : null}
        <div className="inspector-action-row" role="group" aria-label="物体动画操作">
          <button type="button" onClick={() => updateAnimation({ enabled: !animationTrack.enabled })}>
            <Play aria-hidden="true" size={14} />
            {animationTrack.enabled ? "暂停" : "播放"}
          </button>
          {animationTrack.path ? (
            <button
              type="button"
              onClick={() =>
                updateAnimation({ path: { ...animationTrack.path!, points: [...animationTrack.path!.points, prop.transform.position] } })
              }
            >
              <MapPinPlus aria-hidden="true" size={14} />
              添加路径点
            </button>
          ) : null}
          <button type="button" onClick={() => setObjectAnimationTrack(prop.id, null)}>
            <Trash2 aria-hidden="true" size={14} />
            清除
          </button>
        </div>
      </InspectorSection>
    </InspectorPanel>
  );
}
