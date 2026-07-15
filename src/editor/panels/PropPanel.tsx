import { useState } from "react";
import { Boxes, KeyRound, MapPinPlus, Play, Trash2, X } from "lucide-react";
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
  const [keyframeTime, setKeyframeTime] = useState(0);
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
  const updateObjectMaterial = useDirectorStore((state) => state.updateObjectMaterial);
  const updateObjectGeometrySize = useDirectorStore((state) => state.updateObjectGeometrySize);
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

  const recordKeyframe = () => {
    const nextFrame = {
      time: Number(keyframeTime.toFixed(3)),
      position: [...prop.transform.position] as [number, number, number],
      rotation: [...prop.transform.rotation] as [number, number, number],
      scale: [...prop.transform.scale] as [number, number, number],
    };
    const keyframes = [...animationTrack.keyframes.filter((frame) => Math.abs(frame.time - keyframeTime) > 0.001), nextFrame]
      .sort((a, b) => a.time - b.time);
    updateAnimation({ keyframes });
  };

  const updatePathPoint = (pointIndex: number, axis: 0 | 1 | 2, value: number) => {
    if (!animationTrack.path) return;
    const points = animationTrack.path.points.map((point, index) =>
      index === pointIndex ? replaceAxis(point, axis, value) : point
    );
    updateAnimation({ path: { ...animationTrack.path, points } });
  };

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
      {prop.geometrySize ? (
        <InspectorAxisGroup
          label="部件尺寸"
          axes={([0, 1, 2] as const).map((axis) => ({
            axis: (["X", "Y", "Z"] as const)[axis],
            ariaLabel: `模型部件尺寸 ${(["X", "Y", "Z"] as const)[axis]}`,
            step: "0.01",
            value: prop.geometrySize![axis],
            onChange: (value) => updateObjectGeometrySize(
              prop.id,
              replaceAxis(prop.geometrySize!, axis, Math.max(0.001, Number(value)))
            ),
          }))}
        />
      ) : null}
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
      {prop.kind !== "group" ? (
        <InspectorSection title="材质表面">
          <InspectorRangeNumberField
            label="粗糙度"
            rangeAriaLabel="模型材质粗糙度"
            numberAriaLabel="模型材质粗糙度数值"
            min="0"
            max="1"
            step="0.01"
            value={prop.material?.roughness ?? 0.68}
            onValueChange={(value) => updateObjectMaterial(prop.id, { ...prop.material, roughness: Number(value) })}
          />
          <InspectorRangeNumberField
            label="金属度"
            rangeAriaLabel="模型材质金属度"
            numberAriaLabel="模型材质金属度数值"
            min="0"
            max="1"
            step="0.01"
            value={prop.material?.metalness ?? 0.02}
            onValueChange={(value) => updateObjectMaterial(prop.id, { ...prop.material, metalness: Number(value) })}
          />
          <InspectorRangeNumberField
            label="透明度"
            rangeAriaLabel="模型材质透明度"
            numberAriaLabel="模型材质透明度数值"
            min="0.05"
            max="1"
            step="0.01"
            value={prop.material?.opacity ?? 1}
            onValueChange={(value) => updateObjectMaterial(prop.id, { ...prop.material, opacity: Number(value) })}
          />
        </InspectorSection>
      ) : null}
      {selectedObjectIds.length > 1 ? (
        <div className="inspector-action-row">
          <button type="button" onClick={() => groupObjects(selectedObjectIds)}>
            <Boxes aria-hidden="true" size={14} />
            组合所选
          </button>
        </div>
      ) : null}
      <InspectorSection title="动画设置">
        <InspectorSelectField
          label="播放方式"
          ariaLabel="物体动画播放方式"
          value={animationTrack.playbackMode}
          options={[
            { value: "normal", label: "手动播放" },
            { value: "recording-sync", label: "录制时播放" },
            { value: "camera-driven", label: "随镜头运动" },
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
          onChange={(value) => {
            const duration = Number(value) as 5 | 10 | 15;
            setKeyframeTime((current) => Math.min(current, duration));
            updateAnimation({ duration });
          }}
        />
        <div className="inspector-action-row" role="group" aria-label="物体动画操作">
          <button type="button" onClick={() => updateAnimation({ enabled: !animationTrack.enabled })}>
            <Play aria-hidden="true" size={14} />
            {animationTrack.enabled ? "暂停" : "播放"}
          </button>
          <button type="button" onClick={() => setObjectAnimationTrack(prop.id, null)}>
            <Trash2 aria-hidden="true" size={14} />
            清除
          </button>
        </div>
      </InspectorSection>
      <InspectorSection title="关键帧动画" className="object-animation-editor">
        <InspectorRangeNumberField
          label="记录时间"
          rangeAriaLabel="关键帧记录时间滑杆"
          numberAriaLabel="关键帧记录时间"
          min="0"
          max={animationTrack.duration}
          step="0.1"
          value={keyframeTime}
          onValueChange={(value) => setKeyframeTime(Math.min(animationTrack.duration, Math.max(0, Number(value))))}
        />
        <button className="object-animation-primary-action" type="button" onClick={recordKeyframe}>
          <KeyRound aria-hidden="true" size={14} />
          记录当前位置 / 旋转 / 缩放
        </button>
        <div className="object-animation-item-list" aria-label="物体动画关键帧列表">
          {[...animationTrack.keyframes].sort((a, b) => a.time - b.time).map((frame, index) => (
            <div className="object-animation-list-item" key={`${frame.time}-${index}`}>
              <button type="button" className="object-animation-item-main" onClick={() => setKeyframeTime(frame.time)}>
                <span>关键帧 {index + 1}</span>
                <small>{frame.time.toFixed(1)}秒</small>
              </button>
              <button
                type="button"
                className="object-animation-item-delete"
                aria-label={`删除关键帧 ${index + 1}`}
                onClick={() => updateAnimation({ keyframes: animationTrack.keyframes.filter((candidate) => candidate !== frame) })}
              >
                <X aria-hidden="true" size={14} />
              </button>
            </div>
          ))}
        </div>
      </InspectorSection>
      <InspectorSection title="路径点动画" className="object-animation-editor">
        <InspectorSelectField
          label="路径类型"
          ariaLabel="物体动画路径类型"
          value={animationTrack.path?.type ?? "none"}
          options={[
            { value: "none", label: "不使用路径" },
            { value: "linear", label: "直线连接路径点" },
            { value: "curve", label: "平滑曲线连接路径点" },
          ]}
          onChange={(value) =>
            updateAnimation({
              path: value === "none"
                ? undefined
                : {
                    type: value as "linear" | "curve",
                    closed: animationTrack.path?.closed ?? false,
                    orientToPath: animationTrack.path?.orientToPath ?? false,
                    points: animationTrack.path?.points ?? [[...prop.transform.position]],
                  },
            })
          }
        />
        {animationTrack.path ? (
          <>
            <InspectorSelectField
              label="首尾连接"
              ariaLabel="物体动画路径是否闭合"
              value={animationTrack.path.closed ? "closed" : "open"}
              options={[
                { value: "open", label: "开放路径" },
                { value: "closed", label: "闭合循环路径" },
              ]}
              onChange={(value) => updateAnimation({ path: { ...animationTrack.path!, closed: value === "closed" } })}
            />
            <InspectorSelectField
              label="物体朝向"
              ariaLabel="物体动画是否跟随路径朝向"
              value={animationTrack.path.orientToPath ? "follow" : "fixed"}
              options={[
                { value: "fixed", label: "保持原朝向" },
                { value: "follow", label: "沿移动方向转向" },
              ]}
              onChange={(value) => updateAnimation({ path: { ...animationTrack.path!, orientToPath: value === "follow" } })}
            />
            <button
              className="object-animation-primary-action"
              type="button"
              onClick={() => updateAnimation({
                path: { ...animationTrack.path!, points: [...animationTrack.path!.points, [...prop.transform.position]] },
              })}
            >
              <MapPinPlus aria-hidden="true" size={14} />
              把当前物体位置添加为路径点
            </button>
            <div className="object-animation-path-points" aria-label="物体动画路径点列表">
              {animationTrack.path.points.map((point, pointIndex) => (
                <div className="object-animation-path-point" key={pointIndex}>
                  <div className="object-animation-path-point-header">
                    <strong>路径点 {pointIndex + 1}</strong>
                    <button
                      type="button"
                      aria-label={`删除路径点 ${pointIndex + 1}`}
                      onClick={() => updateAnimation({
                        path: { ...animationTrack.path!, points: animationTrack.path!.points.filter((_, index) => index !== pointIndex) },
                      })}
                    >
                      <Trash2 aria-hidden="true" size={13} />
                    </button>
                  </div>
                  <InspectorAxisGroup
                    label="坐标"
                    axes={([0, 1, 2] as const).map((axis) => ({
                      axis: (["X", "Y", "Z"] as const)[axis],
                      ariaLabel: `路径点 ${pointIndex + 1} ${(["X", "Y", "Z"] as const)[axis]}`,
                      value: point[axis],
                      onChange: (value) => updatePathPoint(pointIndex, axis, Number(value)),
                    }))}
                  />
                </div>
              ))}
            </div>
          </>
        ) : null}
      </InspectorSection>
    </InspectorPanel>
  );
}
