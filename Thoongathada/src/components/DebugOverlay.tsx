import type { EyeTrackingState } from "../hooks/useEyeTracking";

type DebugOverlayProps = {
  visible: boolean;
  tracking: EyeTrackingState;
};

export function DebugOverlay({ visible, tracking }: DebugOverlayProps) {
  if (!visible) return null;

  return (
    <aside className="debug-panel">
      <div>Face detected: {tracking.faceDetected ? "YES" : "NO"}</div>
      <div>Left eye blink score: {tracking.leftBlinkScore.toFixed(3)}</div>
      <div>Right eye blink score: {tracking.rightBlinkScore.toFixed(3)}</div>
      <div>Left eye: {tracking.leftClosed ? "CLOSED" : "OPEN"}</div>
      <div>Right eye: {tracking.rightClosed ? "CLOSED" : "OPEN"}</div>
      <div>Current closed duration: {Math.round(tracking.closedDuration)}ms</div>
      <div>Trigger threshold: {tracking.triggerThreshold.toFixed(3)}</div>
      <div>FPS: {tracking.fps}</div>
      <div>Model: {tracking.modelStatus}</div>
    </aside>
  );
}
