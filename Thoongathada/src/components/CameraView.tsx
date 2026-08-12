import { Maximize2 } from "lucide-react";
import type { RefObject } from "react";
import type { EyeTrackingState } from "../hooks/useEyeTracking";

type CameraViewProps = {
  videoRef: RefObject<HTMLVideoElement | null>;
  stream: MediaStream | null;
  attempts: number;
  tracking: EyeTrackingState;
  fullscreen: boolean;
  showHelp: boolean;
  onFullscreen: () => void;
  onHelp: () => void;
};

export function CameraView({
  videoRef,
  stream,
  attempts,
  tracking,
  fullscreen,
  showHelp,
  onFullscreen,
  onHelp
}: CameraViewProps) {
  return (
    <section className="camera-stage">
      <video
        ref={videoRef}
        className="camera-video"
        autoPlay
        playsInline
        muted
        aria-label="Live mirrored webcam"
      />

      <div className="top-left overlay-text">
        <div className="brand-small">THOONGATHA DA</div>
        <div className="watching">
          <span className="pulse-dot" />
          {tracking.modelStatus === "loading" ? "teaching the laptop..." : "watching your eyes"}
        </div>
      </div>

      <div className="attempt-counter overlay-text">sleep attempts: {attempts}</div>

      {!fullscreen && (
        <button className="fullscreen-button" onClick={onFullscreen} aria-label="Toggle fullscreen">
          <Maximize2 size={17} />
        </button>
      )}

      {!fullscreen && (
        <button className="help-button" onClick={onHelp} aria-label="Show keyboard controls">
          ?
        </button>
      )}

      <div className="bottom-nudge overlay-text">don't sleep 💀</div>

      {tracking.modelStatus === "loading" && (
        <div className="center-hint">teaching the laptop how to watch you...</div>
      )}

      {tracking.calibrating && tracking.modelStatus === "ready" && (
        <div className="calibration-hint">
          <span>look at the screen 👀</span>
          <div className="calibration-bar">
            <i style={{ transform: `scaleX(${tracking.calibrationProgress})` }} />
          </div>
        </div>
      )}

      {stream && !tracking.faceDetected && !tracking.calibrating && tracking.modelStatus === "ready" && (
        <div className="center-hint faint">where did you go 👀</div>
      )}

      {showHelp && (
        <div className="shortcuts">
          <b>keys</b>
          <span>F fullscreen</span>
          <span>D debug</span>
          <span>R reset counter</span>
        </div>
      )}
    </section>
  );
}
