export function getVideoFilter(captureFrameRate, maxDurationSeconds) {
  const duration = maxDurationSeconds === 10 || maxDurationSeconds === 15 ? maxDurationSeconds : 5;
  const frameRateFilter =
    captureFrameRate <= 30
      ? "fps=30,minterpolate=fps=60:mi_mode=blend"
      : "fps=60";
  return `setpts=PTS-STARTPTS,${frameRateFilter},tpad=stop_mode=clone:stop_duration=${duration}`;
}
