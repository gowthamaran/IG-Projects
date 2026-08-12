export const CLOSED_DURATION_MS = 1000;
export const SAMPLE_SIZE = 5;

export type EyeSample = {
  leftClosed: boolean;
  rightClosed: boolean;
  faceDetected: boolean;
  time: number;
};

export type SmoothedEyeState = {
  bothClosed: boolean;
  bothOpen: boolean;
  leftClosed: boolean;
  rightClosed: boolean;
};

export function smoothEyeSamples(samples: EyeSample[]): SmoothedEyeState {
  const visible = samples.filter((sample) => sample.faceDetected);

  if (visible.length < 3) {
    return {
      bothClosed: false,
      bothOpen: false,
      leftClosed: false,
      rightClosed: false
    };
  }

  const recent = visible.slice(-SAMPLE_SIZE);
  const leftClosedVotes = recent.filter((sample) => sample.leftClosed).length;
  const rightClosedVotes = recent.filter((sample) => sample.rightClosed).length;
  const leftOpenVotes = recent.filter((sample) => !sample.leftClosed).length;
  const rightOpenVotes = recent.filter((sample) => !sample.rightClosed).length;

  return {
    bothClosed: leftClosedVotes >= 3 && rightClosedVotes >= 3,
    bothOpen: leftOpenVotes >= 3 && rightOpenVotes >= 3,
    leftClosed: leftClosedVotes >= 3,
    rightClosed: rightClosedVotes >= 3
  };
}

export function roastForAttempt(attempts: number) {
  if (attempts === 1) return "caught you sleeping 😭";
  if (attempts === 2) return "AGAIN???";
  if (attempts === 3) return "bro just go to bed 💀";
  if (attempts === 4) return "degree mudichuruviya? 😭";
  return "i give up.";
}
