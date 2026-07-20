let landmarker = null;
let visionModulePromise = null;

function loadVisionModule() {
  visionModulePromise ??= import("./vision_bundle.mjs");
  return visionModulePromise;
}

async function createLandmarker(wasmPath, modelPath, delegate) {
  const { FaceLandmarker, FilesetResolver } = await loadVisionModule();
  const vision = await FilesetResolver.forVisionTasks(wasmPath);
  return FaceLandmarker.createFromOptions(vision, {
    baseOptions: { modelAssetPath: modelPath, delegate },
    runningMode: "VIDEO",
    numFaces: 1,
    outputFaceBlendshapes: true,
    outputFacialTransformationMatrixes: true,
    minFaceDetectionConfidence: 0.55,
    minFacePresenceConfidence: 0.55,
    minTrackingConfidence: 0.55,
  });
}

self.onmessage = async (event) => {
  const message = event.data;
  if (message.type === "init") {
    try {
      try {
        landmarker = await createLandmarker(message.wasmPath, message.modelPath, "GPU");
        self.postMessage({ type: "ready", delegate: "GPU" });
      } catch (gpuError) {
        landmarker = await createLandmarker(message.wasmPath, message.modelPath, "CPU");
        self.postMessage({
          type: "ready",
          delegate: "CPU",
          fallbackReason: gpuError instanceof Error ? gpuError.message : String(gpuError),
        });
      }
    } catch (error) {
      self.postMessage({ type: "error", message: error instanceof Error ? error.message : String(error) });
    }
    return;
  }

  if (message.type !== "frame") return;
  const bitmap = message.bitmap;
  try {
    if (!landmarker) return;
    const result = landmarker.detectForVideo(bitmap, Number(message.timestamp));
    const face = result.faceLandmarks[0];
    self.postMessage({
      type: "result",
      frame: face
        ? {
            timestamp: Number(message.timestamp),
            blendshapes: Object.fromEntries(
              (result.faceBlendshapes[0]?.categories ?? []).map(({ categoryName, score }) => [categoryName, score])
            ),
            matrix: Array.from(result.facialTransformationMatrixes[0]?.data ?? []),
          }
        : null,
    });
  } catch (error) {
    self.postMessage({ type: "frame-error", message: error instanceof Error ? error.message : String(error) });
  } finally {
    bitmap.close();
    self.postMessage({ type: "idle" });
  }
};
