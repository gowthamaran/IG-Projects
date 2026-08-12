import { useCallback, useEffect, useRef, useState } from "react";
import { CameraView } from "./components/CameraView";
import { DebugOverlay } from "./components/DebugOverlay";
import { MovieInterruption } from "./components/MovieInterruption";
import { roastForAttempt } from "./lib/sleepDetection";
import { useEyeTracking } from "./hooks/useEyeTracking";

type Screen = "landing" | "camera" | "error";

function cameraErrorMessage(error: unknown) {
  if (error instanceof DOMException && error.name === "NotFoundError") return "camera enga da 💀";
  return "bro i can't catch you sleeping without the camera 😭";
}

export default function App() {
  const cameraRef = useRef<HTMLVideoElement | null>(null);
  const movieRef = useRef<HTMLVideoElement | null>(null);
  const [screen, setScreen] = useState<Screen>("landing");
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempts, setAttempts] = useState(0);
  const [debug, setDebug] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [fullscreen, setFullscreen] = useState(Boolean(document.fullscreenElement));
  const [alertActive, setAlertActive] = useState(false);
  const [armed, setArmed] = useState(true);
  const [flash, setFlash] = useState(false);
  const [roast, setRoast] = useState<string | null>(null);

  const unlockMovieAudio = useCallback(async () => {
    const movie = movieRef.current;
    if (!movie) return;

    try {
      movie.muted = true;
      movie.volume = 1;
      await movie.play();
      movie.pause();
      movie.currentTime = 0;
      movie.muted = false;
    } catch {
      movie.muted = false;
    }
  }, []);

  const startStudying = useCallback(async () => {
    setError(null);
    setScreen("camera");
    await unlockMovieAudio();

    try {
      const media = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          facingMode: "user"
        },
        audio: false
      });

      setStream(media);
      if (cameraRef.current) {
        cameraRef.current.srcObject = media;
        await cameraRef.current.play();
      }
    } catch (cameraError) {
      setError(cameraErrorMessage(cameraError));
      setScreen("error");
    }
  }, [unlockMovieAudio]);

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

        try {
          movie.pause();
          movie.currentTime = 0;
          movie.muted = false;
          movie.volume = 1;
          await movie.play();
        } catch {
          setRoast("tap once for sound 😭");
          setAlertActive(false);
        }
      }, 140);

      return next;
    });
  }, []);

  const handleMovieEnded = useCallback(() => {
    const message = roastForAttempt(attempts);
    setAlertActive(false);
    setRoast(message);
    window.setTimeout(() => {
      setRoast(null);
    }, 800);
  }, [attempts]);

  const handleReadyToRearm = useCallback(() => {
    setArmed(true);
  }, []);

  const tracking = useEyeTracking({
    videoRef: cameraRef,
    active: screen === "camera" && Boolean(stream),
    alertActive,
    armed,
    onSleepDetected: triggerSleepAlert,
    onReadyToRearm: handleReadyToRearm
  });

  const toggleFullscreen = useCallback(async () => {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
    } else {
      await document.documentElement.requestFullscreen();
    }
  }, []);

  useEffect(() => {
    const handleFullscreen = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", handleFullscreen);
    return () => document.removeEventListener("fullscreenchange", handleFullscreen);
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === "d") setDebug((value) => !value);
      if (event.key.toLowerCase() === "f") void toggleFullscreen();
      if (event.key.toLowerCase() === "r") setAttempts(0);
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [toggleFullscreen]);

  useEffect(() => {
    return () => {
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [stream]);

  return (
    <main className="app">
      {screen === "landing" && (
        <section className="landing">
          <div className="landing-copy">
            <p className="privacy-pill">camera stays on your device 🔒</p>
            <h1>THOONGATHA DA 😭</h1>
            <p>an ai that doesn't let you sleep</p>
            <button className="start-button" onClick={startStudying}>
              START STUDYING
            </button>
          </div>
        </section>
      )}

      {screen === "error" && (
        <section className="landing">
          <div className="landing-copy">
            <h1 className="error-title">{error}</h1>
            <button className="start-button" onClick={startStudying}>
              TRY AGAIN
            </button>
          </div>
        </section>
      )}

      {screen === "camera" && (
        <CameraView
          videoRef={cameraRef}
          stream={stream}
          attempts={attempts}
          tracking={tracking}
          fullscreen={fullscreen}
          showHelp={showHelp}
          onFullscreen={toggleFullscreen}
          onHelp={() => setShowHelp((value) => !value)}
        />
      )}

      <MovieInterruption
        videoRef={movieRef}
        active={alertActive}
        flash={flash}
        roast={roast}
        onEnded={handleMovieEnded}
      />

      <DebugOverlay visible={debug} tracking={tracking} />
    </main>
  );
}
