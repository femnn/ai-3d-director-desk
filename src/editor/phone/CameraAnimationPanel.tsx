import { useEffect, useState } from "react";
import { Download, Film, Play, Trash2, X } from "lucide-react";
import {
  clearPhoneCameraPath,
  exportCameraAnimationVideo,
  getRecordedCameraVideoStatus,
  playCameraAnimation,
  removePhoneCameraPath,
  removeRecordedCameraVideo,
  subscribeLiveVideoRecording,
} from "./phoneCameraControl";
import { useDirectorStore } from "../store/directorStore";

export function CameraAnimationPanel() {
  const [open, setOpen] = useState(false);
  const [, setVideoRevision] = useState(0);
  const animations = useDirectorStore((state) => state.project.cameraAnimations);
  const cameras = useDirectorStore((state) => state.project.cameras);
  const deleteCameraAnimation = useDirectorStore((state) => state.deleteCameraAnimation);
  const handleDeleteAnimation = (animationId: string, cameraId: string) => {
    deleteCameraAnimation(animationId);
    removePhoneCameraPath(cameraId);
    removeRecordedCameraVideo(animationId);
  };
  useEffect(() => subscribeLiveVideoRecording(() => setVideoRevision((revision) => revision + 1)), []);
  const handleExportAnimation = async (animation: (typeof animations)[number]) => {
    try {
      await exportCameraAnimationVideo(animation);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "视频导出失败");
    }
  };

  return (
    <>
      <button
        className="top-bar-action-button"
        type="button"
        aria-label="打开摄像机轨迹"
        title="摄像机轨迹"
        onClick={() => setOpen(true)}
      >
        <Film aria-hidden="true" size={16} strokeWidth={1.8} />
      </button>
      {open ? (
        <div className="camera-animation-panel" role="dialog" aria-label="摄像机轨迹动画">
          <div className="agent-panel-header">
            <div>
              <h2>摄像机轨迹</h2>
              <p>播放、导出或删除手机录制的机位动画。</p>
            </div>
            <button type="button" aria-label="关闭摄像机轨迹" onClick={() => setOpen(false)}>
              <X aria-hidden="true" size={16} />
            </button>
          </div>
          {animations.length ? (
            <ul className="camera-animation-list">
              {animations.map((animation) => {
                const camera = cameras.find((item) => item.id === animation.cameraId);
                const videoStatus = getRecordedCameraVideoStatus(animation.id);
                const videoStatusLabel =
                  videoStatus === "ready"
                    ? "原始录制视频已就绪"
                    : videoStatus === "processing"
                      ? "正在封装原始录制视频"
                      : videoStatus === "failed"
                        ? "原始视频不可用"
                        : "尚未保存原始视频";
                return (
                  <li key={animation.id}>
                    <div>
                      <strong>{animation.name}</strong>
                      <span>{camera?.name ?? "未知机位"} · 原画视频 · {animation.keyframes.length} 帧 · {videoStatusLabel}</span>
                    </div>
                    <button type="button" aria-label={`播放轨迹 ${animation.name}`} onClick={() => playCameraAnimation(animation)}>
                      <Play aria-hidden="true" size={15} />
                    </button>
                    <button
                      type="button"
                      aria-label={`导出视频 ${animation.name}`}
                      onClick={() => void handleExportAnimation(animation)}
                    >
                      <Download aria-hidden="true" size={15} />
                    </button>
                    <button
                      type="button"
                      aria-label={`删除轨迹 ${animation.name}`}
                      onClick={() => handleDeleteAnimation(animation.id, animation.cameraId)}
                    >
                      <Trash2 aria-hidden="true" size={15} />
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="camera-animation-empty">暂无手机录制轨迹</p>
          )}
          <button className="camera-animation-clear-path" type="button" onClick={clearPhoneCameraPath}>
            清空画面轨迹线
          </button>
        </div>
      ) : null}
    </>
  );
}
