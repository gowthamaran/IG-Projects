import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import {
  FaceLandmarker,
  FilesetResolver,
  type Classifications
} from "@mediapipe/tasks-vision";
import {
  CLOSED_DURATION_MS,
  type EyeSample,
  SAMPLE_SIZE,
  smoothEyeSamples
} from "../lib/sleepDetection";

type EyeTrackingOptions = {
  videoRef: RefObject<HTMLVideoElement | null>;
  active: boolean;
  alertActive: boolean;
  armed: boolean;
  onSleepDetected: () => void;
  onReadyToRearm: () => void;
};

export type EyeTrackingState = {
  modelStatus: "idle" | "loading" | "ready" | "error";
  faceDetected: boolean;
  leftBlinkScore: number;
  rightBlinkScore: number;
  leftClosed: boolean;
  rightClosed: boolean;
  bothOpen: boolean;
  closedDuration: number;
  triggerThreshold: number;
  fps: number;
  calibrating: boolean;
  calibrationProgress: number;
  error: string | null;
};

const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task";

const WASM_URL =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22-rc.20250304/wasm";

function scoreFor(categories: Classifications[] | undefined, name: string) {
  for (const classification of categories ?? []) {
    const found = classification.categories.find((category) => category.categoryName === name);
    if (found) return found.score;
  }

  return 0;
}

export function useEyeTracking({
  videoRef,
  active,
  alertActive,
  armed,
  onSleepDetected,
  onReadyToRearm
}: EyeTrackingOptions) {
  const detectorRef = useRef<FaceLandmarker | null>(null);
  const frameRef = useRef<number | null>(null);
  const lastInferenceRef = useRef(0);
  const lastVideoTimeRef = useRef(-1);
  const samplesRef = useRef<EyeSample[]>([]);
  const openCalibrationRef = useRef<{ left: number[]; right: number[]; start: number | null }>({
    left: [],
    right: [],
    start: null
  });
  const closedSinceRef = useRef<number | null>(null);
  const fpsRef = useRef({ frames: 0, since: performance.now() });
  const triggeredRef = useRef(false);
  const callbackRef = useRef({ onSleepDetected, onReadyToRearm });

  const [state, setState] = useState<EyeTrackingState>({
    modelStatus: "idle",
    faceDetected: false,
    leftBlinkScore: 0,
    rightBlinkScore: 0,
    leftClosed: false,
    rightClosed: false,
    bothOpen: false,
    closedDuration: 0,
    triggerThreshold: 0.48,
    fps: 0,
    calibrating: false,
    calibrationProgress: 0,
    error: null
  });

  useEffect(() => {
    callbackRef.current = { onSleepDetected, onReadyToRearm };
  }, [onSleepDetected, onReadyToRearm]);

  useEffect(() => {
    let cancelled = false;

    async function loadDetector() {
      setState((previous) => ({ ...previous, modelStatus: "loading", error: null }));

      try {
        const vision = await FilesetResolver.forVisionTasks(WASM_URL);
        const detector = await FaceLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: MODEL_URL,
            delegate: "GPU"
          },
          outputFaceBlendshapes: true,
          runningMode: "VIDEO",
          numFaces: 1
        });

        if (cancelled) {
          detector.close();
          return;
        }

        detectorRef.current = detector;
        setState((previous) => ({ ...previous, modelStatus: "ready" }));
      } catch (error) {
        setState((previous) => ({
          ...previous,
          modelStatus: "error",
          error: error instanceof Error ? error.message : "MediaPipe failed to load"
        }));
      }
    }

    loadDetector();

    return () => {
      cancelled = true;
      detectorRef.current?.close();
      detectorRef.current = null;
    };
  }, []);

  const resetCalibration = useCallback(() => {
    openCalibrationRef.current = { left: [], right: [], start: null };
    setState((previous) => ({
      ...previous,
      triggerThreshold: 0.48,
      calibrating: true,
      calibrationProgress: 0
    }));
  }, []);

  useEffect(() => {
    if (active && state.modelStatus === "ready") resetCalibration();
  }, [active, resetCalibration, state.modelStatus]);

  const updateCalibration = useCallback((leftScore: number, rightScore: number, now: number) => {
    const calibration = openCalibrationRef.current;
    if (calibration.start === null) calibration.start = now;

    const elapsed = now - calibration.start;
    calibration.left.push(leftScore);
    calibration.right.push(rightScore);

    if (elapsed >= 2000) {
      const combined = [...calibration.left, ...calibration.right];
      const averageOpenScore =
        combined.reduce((total, score) => total + score, 0) / Math.max(combined.length, 1);
      const threshold = Math.min(0.72, Math.max(0.36, averageOpenScore + 0.28));

      setState((previous) => ({
        ...previous,
        triggerThreshold: threshold,
        calibrating: false,
        calibrationProgress: 1
      }));
      return threshold;
    }

    setState((previous) => ({
      ...previous,
      calibrating: true,
      calibrationProgress: Math.min(1, elapsed / 2000)
    }));

    return state.triggerThreshold;
  }, [state.triggerThreshold]);

  const tick = useCallback(() => {
    const video = videoRef.current;
    const detector = detectorRef.current;
    const now = performance.now();

    if (
      active &&
      detector &&
      video &&
      video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
      now - lastInferenceRef.current >= 45 &&
      video.currentTime !== lastVideoTimeRef.current
    ) {
      lastInferenceRef.current = now;
      lastVideoTimeRef.current = video.currentTime;
      fpsRef.current.frames += 1;

      const since = now - fpsRef.current.since;
      let fps = state.fps;
      if (since >= 1000) {
        fps = Math.round((fpsRef.current.frames * 1000) / since);
        fpsRef.current = { frames: 0, since: now };
      }

      const result = detector.detectForVideo(video, now);
      const faceDetected = result.faceLandmarks.length > 0;
      const leftBlinkScore = faceDetected ? scoreFor(result.faceBlendshapes, "eyeBlinkLeft") : 0;
      const rightBlinkScore = faceDetected ? scoreFor(result.faceBlendshapes, "eyeBlinkRight") : 0;
      const threshold = faceDetected ? updateCalibration(leftBlinkScore, rightBlinkScore, now) : state.triggerThreshold;
      const leftClosed = faceDetected && leftBlinkScore > threshold;
      const rightClosed = faceDetected && rightBlinkScore > threshold;

      samplesRef.current = [
        ...samplesRef.current.slice(-(SAMPLE_SIZE - 1)),
        { leftClosed, rightClosed, faceDetected, time: now }
      ];

      const smoothed = smoothEyeSamples(samplesRef.current);

      if (!faceDetected || alertActive) {
        closedSinceRef.current = null;
        triggeredRef.current = false;
      } else if (!armed) {
        closedSinceRef.current = null;
        if (smoothed.bothOpen) callbackRef.current.onReadyToRearm();
      } else if (smoothed.bothClosed && !state.calibrating) {
        if (closedSinceRef.current === null) closedSinceRef.current = now;
        const closedDuration = now - closedSinceRef.current;
        if (closedDuration >= CLOSED_DURATION_MS && !triggeredRef.current) {
          triggeredRef.current = true;
          callbackRef.current.onSleepDetected();
        }
      } else {
        closedSinceRef.current = null;
        triggeredRef.current = false;
      }

      setState((previous) => ({
        ...previous,
        faceDetected,
        leftBlinkScore,
        rightBlinkScore,
        leftClosed: smoothed.leftClosed,
        rightClosed: smoothed.rightClosed,
        bothOpen: smoothed.bothOpen,
        closedDuration: closedSinceRef.current ? now - closedSinceRef.current : 0,
        fps
      }));
    }

    frameRef.current = requestAnimationFrame(tick);
  }, [active, alertActive, armed, state.calibrating, state.fps, state.triggerThreshold, updateCalibration, videoRef]);

  useEffect(() => {
    frameRef.current = requestAnimationFrame(tick);

    return () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
    };
  }, [tick]);

  return useMemo(() => state, [state]);
}
