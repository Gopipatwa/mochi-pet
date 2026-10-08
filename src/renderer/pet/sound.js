/* Tiny synthesised chimes, so the app needs no audio files. */
(function (g) {
  'use strict';
  let ctx = null;
  const NOTES = {
    reminder: [[659.25, 0], [880, 0.16], [1108.7, 0.32]],
    meeting: [[783.99, 0], [1046.5, 0.15], [1318.5, 0.3], [1046.5, 0.55], [1318.5, 0.7]],
  };

  function play(kind, volume) {
    const notes = NOTES[kind];
    if (!notes || volume <= 0) return;
    try {
      ctx = ctx || new AudioContext();
      if (ctx.state === 'suspended') ctx.resume();
      const now = ctx.currentTime;
      for (const [freq, at] of notes) {
        const osc = ctx.createOscillator(); const gain = ctx.createGain();
        osc.type = 'sine'; osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.0001, now + at);
        gain.gain.exponentialRampToValueAtTime(0.25 * volume, now + at + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + at + 0.5);
        osc.connect(gain).connect(ctx.destination);
        osc.start(now + at); osc.stop(now + at + 0.55);
      }
    } catch { /* audio is a nice-to-have */ }
  }
  g.Sound = { play };
})(window);
