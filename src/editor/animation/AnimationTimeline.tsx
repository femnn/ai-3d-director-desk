import { Pause, Play, Repeat2, RotateCcw, Trash2, X } from "lucide-react";
import {
  pauseAnimationSequence,
  playAnimationSequence,
  scrubAnimationSequence,
  useAnimationSequenceRuntime,
} from "./animationSequence";
import type { DirectorAnimationSequence } from "../schema/directorProject";
import { useDirectorStore } from "../store/directorStore";
import { stopNormalCharacterAnimations } from "./characterAnimation";

function createEmptySequence(index: number): DirectorAnimationSequence {
  return {
    id: `sequence_${index}`,
    name: `动画序列${String(index).padStart(2, "0")}`,
    duration: 5,
    playbackMode: "manual",
    loop: true,
    enabled: true,
    cameraId: null,
    bindings: [],
    tracks: [],
  };
}

export function AnimationTimeline({ onClose }: { onClose: () => void }) {
  const sequences = useDirectorStore((state) => state.project.animationSequences ?? []);
  const activeId = useDirectorStore((state) => state.project.activeAnimationSequenceId ?? null);
  const objects = useDirectorStore((state) => state.project.objects);
  const addSequence = useDirectorStore((state) => state.addAnimationSequence);
  const updateSequence = useDirectorStore((state) => state.updateAnimationSequence);
  const deleteSequence = useDirectorStore((state) => state.deleteAnimationSequence);
  const setActiveSequence = useDirectorStore((state) => state.setActiveAnimationSequence);
  const selectObject = useDirectorStore((state) => state.selectObject);
  const runtime = useAnimationSequenceRuntime();
  const sequence = sequences.find((candidate) => candidate.id === activeId) ?? sequences[0];
  const elapsed = runtime.sequenceId === sequence?.id ? runtime.elapsed : 0;
  const isCurrentSequencePlaying = Boolean(sequence && runtime.sequenceId === sequence.id && runtime.playing);

  const selectSequence = (id: string) => {
    pauseAnimationSequence();
    stopNormalCharacterAnimations();
    setActiveSequence(id);
    const nextSequence = sequences.find((candidate) => candidate.id === id);
    if (nextSequence) playAnimationSequence(nextSequence, { reset: true });
  };

  const addEmptySequence = () => {
    const id = addSequence(createEmptySequence(sequences.length + 1));
    setActiveSequence(id);
    const created = useDirectorStore.getState().project.animationSequences?.find((candidate) => candidate.id === id);
    if (created) playAnimationSequence(created, { reset: true });
  };

  return (
    <section className="animation-timeline" aria-label="统一动画时间轴">
      <header className="animation-timeline-header">
        <div className="animation-timeline-title">
          <strong>动画时间轴</strong>
          <select
            aria-label="当前动画序列"
            value={sequence?.id ?? ""}
            onChange={(event) => selectSequence(event.currentTarget.value)}
          >
            {!sequences.length ? <option value="">暂无序列</option> : null}
            {sequences.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}
          </select>
          <button type="button" onClick={addEmptySequence}>+新建</button>
        </div>
        {sequence ? (
          <div className="animation-timeline-controls" role="group" aria-label="动画播放控制">
            <button
              aria-label={
                isCurrentSequencePlaying
                  ? "暂停动画"
                  : "播放动画"
              }
              type="button"
              onClick={() => {
                if (isCurrentSequencePlaying) {
                  pauseAnimationSequence();
                } else {
                  stopNormalCharacterAnimations();
                  const playableSequence = sequence.enabled ? sequence : { ...sequence, enabled: true };
                  if (!sequence.enabled) updateSequence(sequence.id, { enabled: true });
                  playAnimationSequence(playableSequence, {
                    reset: runtime.sequenceId !== sequence.id || runtime.elapsed >= sequence.duration,
                  });
                }
              }}
            >
              {isCurrentSequencePlaying ? <Pause size={15} /> : <Play size={15} />}
            </button>
            <button aria-label="回到开头" type="button" onClick={() => scrubAnimationSequence(sequence, 0)}>
              <RotateCcw size={15} />
            </button>
            <select
              aria-label="动画序列时长"
              value={sequence.duration}
              onChange={(event) => updateSequence(sequence.id, { duration: Number(event.currentTarget.value) as 5 | 10 | 15 })}
            >
              {[5, 10, 15].map((duration) => <option key={duration} value={duration}>{duration}秒</option>)}
            </select>
            <span className="animation-timeline-loop is-active" aria-label="动画自动循环">
              <Repeat2 aria-hidden="true" size={15} />
              自动循环
            </span>
            <button aria-label="删除动画序列" type="button" onClick={() => deleteSequence(sequence.id)}>
              <Trash2 size={15} />
            </button>
          </div>
        ) : null}
        <button className="animation-timeline-close" aria-label="收起动画时间轴" type="button" onClick={onClose}>
          <X size={16} />
        </button>
      </header>

      {sequence ? (
        <div className="animation-timeline-body">
          <div className="animation-timeline-ruler">
            <span>{elapsed.toFixed(2)}s</span>
            <input
              aria-label="动画播放头"
              max={sequence.duration}
              min="0"
              step="0.01"
              type="range"
              value={elapsed}
              onChange={(event) => scrubAnimationSequence(sequence, Number(event.currentTarget.value))}
            />
            <span>{sequence.duration}s</span>
          </div>
          <div className="animation-timeline-track-list">
            {sequence.tracks.length ? sequence.tracks.map((track) => {
              const binding = sequence.bindings.find((candidate) => candidate.alias === track.binding);
              const target = objects.find((object) => object.id === binding?.objectId);
              const left = `${(track.startTime / sequence.duration) * 100}%`;
              const width = `${((track.endTime - track.startTime) / sequence.duration) * 100}%`;
              return (
                <button
                  className={`animation-timeline-track is-${track.type}`}
                  key={track.id}
                  type="button"
                  onClick={() => target && selectObject(target.id)}
                >
                  <span className="animation-timeline-track-label">
                    <strong>{target?.name ?? binding?.objectName ?? track.binding}</strong>
                    <small>{track.name}</small>
                  </span>
                  <span className="animation-timeline-track-lane">
                    <span className="animation-timeline-track-clip" style={{ left, width }}>
                      {track.type === "character" ? "角色动作" : "物体运动"}
                    </span>
                  </span>
                </button>
              );
            }) : (
              <p className="animation-timeline-empty">当前序列没有轨道，可从 AI 布景面板导入动画命令。</p>
            )}
          </div>
        </div>
      ) : (
        <p className="animation-timeline-empty">新建空序列，或从 AI 布景面板导入 `storyai-animation-sequence` JSON。</p>
      )}
    </section>
  );
}
