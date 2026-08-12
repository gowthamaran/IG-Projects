"use client";

import { Maximize2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  FaceLandmarker,
  FilesetResolver,
  type Classifications,
  type NormalizedLandmark
} from "@mediapipe/tasks-vision";

const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task";
const WASM_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22-rc.20250304/wasm";
const CLOSED_DURATION_MS = 1000;
const DEFAULT_BLINK_THRESHOLD = 0.32;
const DEFAULT_EAR_THRESHOLD = 0.2;

type Screen = "landing" | "camera" | "error";
type Sample = { leftClosed: boolean; rightClosed: boolean; faceDetected: boolean };

function scoreFor(categories: Classifications[] | undefined, name: string) {
  for (const classification of categories ?? []) {
    const found = classification.categories.find((category) => category.categoryName === name);
    if (found) return found.score;
  }
  return 0;
}

function distance(a: NormalizedLandmark, b: NormalizedLandmark) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function eyeAspectRatio(landmarks: NormalizedLandmark[], points: [number, number, number, number, number, number]) {
  const [outer, upperOuter, upperInner, inner, lowerInner, lowerOuter] = points;
  const width = distance(landmarks[outer], landmarks[inner]);
  if (!width) return 0;
  const height =
    (distance(landmarks[upperOuter], landmarks[lowerOuter]) +
      distance(landmarks[upperInner], landmarks[lowerInner])) /
    2;
  return height / width;
}

function smooth(samples: Sample[]) {
  const visible = samples.filter((sample) => sample.faceDetected).slice(-5);
  if (visible.length < 2) return { bothClosed: false, bothOpen: false, leftClosed: false, rightClosed: false };
  const leftClosedVotes = visible.filter((sample) => sample.leftClosed).length;
  const rightClosedVotes = visible.filter((sample) => sample.rightClosed).length;
  const leftOpenVotes = visible.filter((sample) => !sample.leftClosed).length;
  const rightOpenVotes = visible.filter((sample) => !sample.rightClosed).length;
  return {
    bothClosed: leftClosedVotes >= 2 && rightClosedVotes >= 2,
    bothOpen: leftOpenVotes >= 3 && rightOpenVotes >= 3,
    leftClosed: leftClosedVotes >= 2,
    rightClosed: rightClosedVotes >= 2
  };
}

function roastForAttempt(attempts: number) {
  if (attempts === 1) return "caught you sleeping 😭";
  if (attempts === 2) return "AGAIN???";
  if (attempts === 3) return "bro just go to bed 💀";
  if (attempts === 4) return "degree mudichuruviya? 😭";
  return "i give up.";
}

export default function Page() {
  const cameraRef = useRef<HTMLVideoElement | null>(null);
  const movieRef = useRef<HTMLVideoElement | null>(null);
  const detectorRef = useRef<FaceLandmarker | null>(null);
  const rafRef = useRef<number | null>(null);
  const samplesRef = useRef<Sample[]>([]);
  const closedSinceRef = useRef<number | null>(null);
  const triggeredRef = useRef(false);
  const lastInferenceRef = useRef(0);
  const lastVideoTimeRef = useRef(-1);
  const calibrationRef = useRef({
    start: null as number | null,
    done: false,
    leftBlink: [] as number[],
    rightBlink: [] as number[],
    leftEar: [] as number[],
    rightEar: [] as number[]
  });

  const [screen, setScreen] = useState<Screen>("landing");
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState("");
  const [attempts, setAttempts] = useState(0);
  const [debug, setDebug] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [alertActive, setAlertActive] = useState(false);
  const [armed, setArmed] = useState(true);
  const [flash, setFlash] = useState(false);
  const [roast, setRoast] = useState<string | null>(null);
  const [tracking, setTracking] = useState({
    modelStatus: "loading",
    faceDetected: false,
    leftBlinkScore: 0,
    rightBlinkScore: 0,
    leftEar: 0,
    rightEar: 0,
    leftClosed: false,
    rightClosed: false,
    closedDuration: 0,
    blinkThreshold: DEFAULT_BLINK_THRESHOLD,
    earThreshold: DEFAULT_EAR_THRESHOLD,
    calibrating: false,
    calibrationProgress: 0,
    fps: 0
  });

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const vision = await FilesetResolver.forVisionTasks(WASM_URL);
        const detector = await FaceLandmarker.createFromOptions(vision, {
          baseOptions: { modelAssetPath: MODEL_URL, delegate: "GPU" },
          outputFaceBlendshapes: true,
          runningMode: "VIDEO",
          numFaces: 1
        });
        if (cancelled) {
          detector.close();
          return;
        }
        detectorRef.current = detector;
        setTracking((value) => ({ ...value, modelStatus: "ready" }));
      } catch {
        setTracking((value) => ({ ...value, modelStatus: "error" }));
      }
    }
    load();
    return () => {
      cancelled = true;
      detectorRef.current?.close();
    };
  }, []);

  const triggerSleepAlert = useCallback(() => {
    setAlertActive(true);
    setArmed(false);
    setRoast(null);
    setAttempts((current) => {
      const next = current + 1;
      setFlash(true);
      window.setTimeout(async () => {
        setFlash(false);
        const movie = movieRef.current;
        if (!movie) return;
        movie.pause();
        movie.currentTime = 0;
        movie.muted = false;
        movie.volume = 1;
        try {
          await movie.play();
        } catch {
          setRoast("tap once for sound 😭");
          setAlertActive(false);
        }
      }, 120);
      return next;
    });
  }, []);

  useEffect(() => {
    const tick = () => {
      const detector = detectorRef.current;
      const video = cameraRef.current;
      const now = performance.now();

      if (
        screen === "camera" &&
        stream &&
        detector &&
        video &&
        video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
        now - lastInferenceRef.current >= 45 &&
        video.currentTime !== lastVideoTimeRef.current
      ) {
        lastInferenceRef.current = now;
        lastVideoTimeRef.current = video.currentTime;
        const result = detector.detectForVideo(video, now);
        const faceDetected = result.faceLandmarks.length > 0;
        const landmarks = result.faceLandmarks[0] ?? [];
        const leftBlinkScore = faceDetected ? scoreFor(result.faceBlendshapes, "eyeBlinkLeft") : 0;
        const rightBlinkScore = faceDetected ? scoreFor(result.faceBlendshapes, "eyeBlinkRight") : 0;
        const leftEar = faceDetected ? eyeAspectRatio(landmarks, [33, 160, 158, 133, 153, 144]) : 0;
        const rightEar = faceDetected ? eyeAspectRatio(landmarks, [362, 385, 387, 263, 373, 380]) : 0;
        let blinkThreshold = tracking.blinkThreshold;
        let earThreshold = tracking.earThreshold;
        const calibration = calibrationRef.current;

        if (faceDetected && !calibration.done) {
          if (calibration.start === null) calibration.start = now;
          calibration.leftBlink.push(leftBlinkScore);
          calibration.rightBlink.push(rightBlinkScore);
          if (leftEar > 0) calibration.leftEar.push(leftEar);
          if (rightEar > 0) calibration.rightEar.push(rightEar);
          const elapsed = now - calibration.start;
          if (elapsed >= 2000) {
            const blinkScores = [...calibration.leftBlink, ...calibration.rightBlink];
            const earScores = [...calibration.leftEar, ...calibration.rightEar];
            const averageBlink = blinkScores.reduce((sum, score) => sum + score, 0) / Math.max(blinkScores.length, 1);
            const averageEar = earScores.reduce((sum, score) => sum + score, 0) / Math.max(earScores.length, 1);
            blinkThreshold = Math.min(0.55, Math.max(0.24, averageBlink + 0.18));
            earThreshold = Math.min(0.24, Math.max(0.14, averageEar * 0.68));
            calibration.done = true;
          }
        }

        const leftClosed =
          faceDetected && (leftBlinkScore > blinkThreshold || (leftEar > 0 && leftEar < earThreshold));
        const rightClosed =
          faceDetected && (rightBlinkScore > blinkThreshold || (rightEar > 0 && rightEar < earThreshold));
        samplesRef.current = [...samplesRef.current.slice(-4), { leftClosed, rightClosed, faceDetected }];
        const smoothed = smooth(samplesRef.current);

        if (!faceDetected || alertActive) {
          closedSinceRef.current = null;
          triggeredRef.current = false;
        } else if (!armed) {
          closedSinceRef.current = null;
          if (smoothed.bothOpen) setArmed(true);
        } else if (smoothed.bothClosed && calibration.done) {
          if (closedSinceRef.current === null) closedSinceRef.current = now;
          if (now - closedSinceRef.current >= CLOSED_DURATION_MS && !triggeredRef.current) {
            triggeredRef.current = true;
            triggerSleepAlert();
          }
        } else {
          closedSinceRef.current = null;
          triggeredRef.current = false;
        }

        setTracking((value) => ({
          ...value,
          faceDetected,
          leftBlinkScore,
          rightBlinkScore,
          leftEar,
          rightEar,
          leftClosed: smoothed.leftClosed,
          rightClosed: smoothed.rightClosed,
          closedDuration: closedSinceRef.current ? now - closedSinceRef.current : 0,
          blinkThreshold,
          earThreshold,
          calibrating: !calibration.done,
          calibrationProgress: calibration.start ? Math.min(1, (now - calibration.start) / 2000) : 0
        }));
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [alertActive, armed, screen, stream, tracking.blinkThreshold, tracking.earThreshold, triggerSleepAlert]);

  const startStudying = async () => {
    setScreen("camera");
    try {
      const movie = movieRef.current;
      if (movie) {
        movie.muted = true;
        await movie.play().catch(() => undefined);
        movie.pause();
        movie.currentTime = 0;
        movie.muted = false;
      }
      const media = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" },
        audio: false
      });
      setStream(media);
      calibrationRef.current = {
        start: null,
        done: false,
        leftBlink: [],
        rightBlink: [],
        leftEar: [],
        rightEar: []
      };
      if (cameraRef.current) {
        cameraRef.current.srcObject = media;
        await cameraRef.current.play();
      }
    } catch (cameraError) {
      setError(cameraError instanceof DOMException && cameraError.name === "NotFoundError" ? "camera enga da 💀" : "bro i can't catch you sleeping without the camera 😭");
      setScreen("error");
    }
  };

  const toggleFullscreen = async () => {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  };

  useEffect(() => {
    const onFullscreen = () => setFullscreen(Boolean(document.fullscreenElement));
    const onKey = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === "d") setDebug((value) => !value);
      if (event.key.toLowerCase() === "f") void toggleFullscreen();
      if (event.key.toLowerCase() === "r") setAttempts(0);
    };
    document.addEventListener("fullscreenchange", onFullscreen);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("fullscreenchange", onFullscreen);
      window.removeEventListener("keydown", onKey);
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [stream]);

  const message = useMemo(() => roastForAttempt(attempts), [attempts]);

  return (
    <main className="app">
      {screen === "landing" && (
        <section className="landing">
          <div className="landing-copy">
            <p className="privacy-pill">camera stays on your device 🔒</p>
            <h1>THOONGATHA DA 😭</h1>
            <p>an ai that doesn't let you sleep</p>
            <button className="start-button" onClick={startStudying}>START STUDYING</button>
          </div>
        </section>
      )}
      {screen === "error" && (
        <section className="landing">
          <div className="landing-copy">
            <h1 className="error-title">{error}</h1>
            <button className="start-button" onClick={startStudying}>TRY AGAIN</button>
          </div>
        </section>
      )}
      {screen === "camera" && (
        <section className="camera-stage">
          <video ref={cameraRef} className="camera-video" autoPlay playsInline muted />
          <div className="top-left overlay-text">
            <div className="brand-small">THOONGATHA DA</div>
            <div className="watching"><span className="pulse-dot" />watching your eyes</div>
          </div>
          <div className="attempt-counter overlay-text">sleep attempts: {attempts}</div>
          {!fullscreen && <button className="fullscreen-button" onClick={toggleFullscreen} aria-label="Toggle fullscreen"><Maximize2 size={17} /></button>}
          {!fullscreen && <button className="help-button" onClick={() => setShowHelp((value) => !value)} aria-label="Show keyboard controls">?</button>}
          <div className="bottom-nudge overlay-text">don't sleep 💀</div>
          {tracking.modelStatus === "loading" && <div className="center-hint">teaching the laptop how to watch you...</div>}
          {tracking.calibrating && tracking.modelStatus === "ready" && (
            <div className="calibration-hint">
              <span>look at the screen 👀</span>
              <div className="calibration-bar"><i style={{ transform: `scaleX(${tracking.calibrationProgress})` }} /></div>
            </div>
          )}
          {stream && !tracking.faceDetected && !tracking.calibrating && tracking.modelStatus === "ready" && <div className="center-hint">where did you go 👀</div>}
          {showHelp && <div className="shortcuts"><b>keys</b><span>F fullscreen</span><span>D debug</span><span>R reset counter</span></div>}
        </section>
      )}
      <div className={`interruption ${alertActive || flash || roast ? "show" : ""}`}>
        <div className={`flash ${flash ? "on" : ""}`} />
        <video
          ref={movieRef}
          className={`movie-video ${alertActive ? "show" : ""}`}
          src="/videos/thoongatha-dialogue.webm"
          preload="auto"
          playsInline
          onEnded={() => {
            setAlertActive(false);
            setRoast(message);
            window.setTimeout(() => setRoast(null), 800);
          }}
        />
        {roast && <div className="roast-message">{roast}</div>}
      </div>
      {debug && (
        <aside className="debug-panel">
          <div>Face detected: {tracking.faceDetected ? "YES" : "NO"}</div>
          <div>Left blink: {tracking.leftBlinkScore.toFixed(3)}</div>
          <div>Right blink: {tracking.rightBlinkScore.toFixed(3)}</div>
          <div>Left EAR: {tracking.leftEar.toFixed(3)}</div>
          <div>Right EAR: {tracking.rightEar.toFixed(3)}</div>
          <div>Left eye: {tracking.leftClosed ? "CLOSED" : "OPEN"}</div>
          <div>Right eye: {tracking.rightClosed ? "CLOSED" : "OPEN"}</div>
          <div>Closed duration: {Math.round(tracking.closedDuration)}ms</div>
          <div>Blink threshold: {tracking.blinkThreshold.toFixed(3)}</div>
          <div>EAR threshold: {tracking.earThreshold.toFixed(3)}</div>
          <div>Model: {tracking.modelStatus}</div>
        </aside>
      )}
    </main>
  );
}
