import React, { useEffect, useRef, useState } from 'react';
import { stationSyncLoopsUrl } from '../utils/assets';
import { playSound } from '../utils/uiSounds';

// The animated splash: the department patch, large, with one light shimmer across it.
//
// It plays once per full page load, then hands over to whatever the app is showing - the dashboard
// for a member, the sign-in screen for a stranger, or the boot screen if the app is still loading.
// The app's data loads DURING the animation (loadAppData runs on mount, concurrently), so on an
// ordinary launch the splash fades straight into a ready app and no spinner is ever seen; the boot
// screen only appears when loading has outlasted the beat on a slow connection.
//
// The timings are deliberately outside the app's motion vocabulary (see index.css and
// verify:motion): a splash is a brand moment rather than a response to a press, so its whole point
// is to last a beat longer than the app ever does. It is still a one-shot - nothing loops - and it
// is silenced entirely for prefers-reduced-motion, where it becomes a still logo cut away quickly.
//
// The logo comes from stationLogoUrl() rather than a hardcoded path: the filename has spaces, and
// the helper carries the BASE_URL and the percent-encoding (see utils/assets.js).

// The beat, in one place: the loops emblem settles by ~0.7s, the shimmer sweeps from 0.3s to ~1.2s,
// the wordmark slides out from behind the loops by ~1.65s, the fade starts at 2.2s, and onFinish
// fires 0.3s later (2.5s), unmounting the splash (App holds splashDone).
const FADE_START_MS = 2200;
const FADE_MS = 300;

export default function SplashScreen({ onFinish }) {
  const [fading, setFading] = useState(false);
  const playedAudioRef = useRef(false);

  // The callback lives in a ref so the timers are armed ONCE. onFinish is an inline arrow in
  // App.jsx and changes identity on every parent render - keying the effect on it (as the sample
  // this was adapted from did) would restart the clock on every data load that lands mid-splash.
  // The ref is written from an effect, not render, per the rules-of-hooks lint.
  const onFinishRef = useRef(onFinish);
  useEffect(() => {
    onFinishRef.current = onFinish;
  }, [onFinish]);

  // Option 1: Opportunistic audio play. On desktop Chrome with Media Engagement Index (MEI),
  // this plays automatically on launch. On mobile/Safari where unprompted audio is blocked,
  // the one-shot capture listener triggers it instantly upon the user's first touch/tap.
  useEffect(() => {
    const playIntro = () => {
      if (playedAudioRef.current) return;
      playSound('intro_short', {
        onPlay: () => {
          playedAudioRef.current = true;
        },
        onBlocked: () => {
          playedAudioRef.current = false;
        },
      });
    };

    // Trigger shortly after mount as the shimmer sweeps (~250ms)
    const audioTimer = setTimeout(playIntro, 250);

    const handleInteraction = () => {
      if (!playedAudioRef.current) {
        playIntro();
      }
    };

    window.addEventListener('pointerdown', handleInteraction, { capture: true });
    window.addEventListener('keydown', handleInteraction, { capture: true });

    return () => {
      clearTimeout(audioTimer);
      window.removeEventListener('pointerdown', handleInteraction, { capture: true });
      window.removeEventListener('keydown', handleInteraction, { capture: true });
    };
  }, []);

  useEffect(() => {
    const fadeTimer = setTimeout(() => setFading(true), FADE_START_MS);
    const doneTimer = setTimeout(() => onFinishRef.current?.(), FADE_START_MS + FADE_MS);
    return () => {
      clearTimeout(fadeTimer);
      clearTimeout(doneTimer);
    };
  }, []);

  return (
    <div className={`splash-screen${fading ? ' splash-screen--fade' : ''}`} aria-hidden="true">
      {/* --splash-logo feeds the shimmer's mask (index.css): the glare is masked with the emblem's own
          alpha channel, so it lights up the artwork and never the transparent canvas around it. */}
      <div className="splash-lockup">
        <div className="splash-logo-wrap" style={{ '--splash-logo': `url("${stationSyncLoopsUrl()}")` }}>
          <img src={stationSyncLoopsUrl()} alt="StationSync" className="splash-logo" />
          <div className="splash-shimmer" />
        </div>
        <div className="splash-wordmark-wrap">
          <div className="splash-wordmark-text">
            <span className="splash-wordmark-station">Station</span>
            <span className="splash-wordmark-sync">Sync</span>
          </div>
        </div>
      </div>
    </div>
  );
}
