import type { RefObject } from "react";

type MovieInterruptionProps = {
  videoRef: RefObject<HTMLVideoElement | null>;
  active: boolean;
  flash: boolean;
  roast: string | null;
  onEnded: () => void;
};

export function MovieInterruption({ videoRef, active, flash, roast, onEnded }: MovieInterruptionProps) {
  return (
    <div className={`interruption ${active || flash || roast ? "show" : ""}`}>
      <div className={`flash ${flash ? "on" : ""}`} />
      <video
        ref={videoRef}
        className={`movie-video ${active ? "show" : ""}`}
        src="/videos/thoongatha-dialogue.webm"
        preload="auto"
        playsInline
        onEnded={onEnded}
      />
      {roast && <div className="roast-message">{roast}</div>}
    </div>
  );
}
