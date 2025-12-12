// Synchronized animation helper
// All pulsing elements use the same CSS animation defined in index.css
// No delay manipulation - elements naturally sync when added together

export const ANIMATION_DURATION = 1500; // 1.5s

// Simple animation style - relies on elements being rendered together
export const getSyncedAnimationStyle = () => ({
  animation: `syncPulse ${ANIMATION_DURATION}ms infinite`,
});

export const PULSE_DURATION = ANIMATION_DURATION;

