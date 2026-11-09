import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import './SplashScreen.css';
import splashImage from '../assets/Nebula-splash.jpeg';
import { NebulaLogo } from './NebulaLogo';

export const SPLASH_TIMING = Object.freeze({
  loadingMs: 2000,
  contentFadeMs: 250,
  logoTravelMs: 900,
  appRevealMs: 900,
  reducedMotionFadeMs: 200,
  appStartScale: 0.98,
  travelEasing: 'cubic-bezier(0.42, 0, 0.58, 1)',
  revealEasing: 'cubic-bezier(0.22, 1, 0.36, 1)',
});

type SplashPhase = 'loading' | 'travel' | 'reveal' | 'done';
type RevealOrigin = { x: number; y: number };

type SplashScreenProps = {
  appShellRef: RefObject<HTMLDivElement | null>;
  onPhaseChange: (
    phase: SplashPhase,
    origin?: RevealOrigin,
    reducedMotion?: boolean,
  ) => void;
};

export function SplashScreen({ appShellRef, onPhaseChange }: SplashScreenProps) {
  const [assetsReady, setAssetsReady] = useState(false);
  const visualRef = useRef<HTMLDivElement>(null);
  const backgroundRef = useRef<HTMLImageElement>(null);
  const logoRef = useRef<HTMLImageElement>(null);
  const loaderRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    const logo = logoRef.current;
    const background = backgroundRef.current;

    void Promise.all([
      document.fonts.ready,
      decodeImage(background),
      decodeImage(logo),
    ]).then(() => {
      if (!cancelled) setAssetsReady(true);
    });

    return () => { cancelled = true; };
  }, []);

  useLayoutEffect(() => {
    if (!assetsReady) return;

    const background = backgroundRef.current;
    const logo = logoRef.current;
    if (!background || !logo) return;

    const placeLogo = () => {
      const bounds = background.getBoundingClientRect();
      const scale = Math.min(
        bounds.width / background.naturalWidth,
        bounds.height / background.naturalHeight,
      );
      const size = Math.max(68, 90 * scale);
      let left = bounds.left + (bounds.width - background.naturalWidth * scale) / 2 + 70 * scale;
      let top = bounds.top + (bounds.height - background.naturalHeight * scale) / 2 + 5 * scale;

      // Keep the animated mark readable when the artwork is scaled for mobile.
      if (left + size < 0 || left > window.innerWidth - 16) {
        const mobileSize = Math.min(76, Math.max(60, window.innerWidth * 0.19));
        left = Math.max(16, (window.innerWidth - mobileSize) / 2);
        top = Math.max(18, Math.min(window.innerHeight * 0.12, 96));
        logo.style.width = `${mobileSize}px`;
        logo.style.height = `${mobileSize}px`;
      } else {
        logo.style.width = `${size}px`;
        logo.style.height = `${size}px`;
      }

      logo.style.left = `${left}px`;
      logo.style.top = `${top}px`;
      logo.style.visibility = 'visible';
      logo.style.opacity = '1';
    };

    placeLogo();
    window.addEventListener('resize', placeLogo);
    return () => window.removeEventListener('resize', placeLogo);
  }, [assetsReady]);

  useEffect(() => {
    if (!assetsReady) return;

    let cancelled = false;
    const animations: Animation[] = [];
    const animate = (
      element: Element,
      keyframes: Keyframe[],
      options: KeyframeAnimationOptions,
    ) => {
      const animation = element.animate(keyframes, options);
      animations.push(animation);
      return animation;
    };

    const startReveal = (
      origin: RevealOrigin,
      reducedMotion: boolean,
      visualAlreadyHidden = false,
    ) => {
      onPhaseChange('reveal', origin, reducedMotion);
      const duration = reducedMotion
        ? SPLASH_TIMING.reducedMotionFadeMs
        : SPLASH_TIMING.contentFadeMs;
      const visual = visualRef.current;
      const logo = logoRef.current;
      if (visual && !visualAlreadyHidden) {
        const currentOpacity = Number.parseFloat(getComputedStyle(visual).opacity);
        animate(visual, [
          { opacity: Number.isFinite(currentOpacity) ? currentOpacity : 1 },
          { opacity: 0 },
        ], {
          duration,
          easing: 'ease-out',
          fill: 'forwards',
        });
      }
      if (reducedMotion && logo) {
        animate(logo, [{ opacity: 1 }, { opacity: 0 }], {
          duration,
          easing: 'ease-out',
          fill: 'forwards',
        });
      }
    };

    const run = async () => {
      const loader = loaderRef.current;
      if (!loader) return;

      loader.style.transform = 'scaleX(0)';
      const loadingAnimation = animate(loader, [
        { transform: 'scaleX(0)' },
        { transform: 'scaleX(1)' },
      ], {
        duration: SPLASH_TIMING.loadingMs,
        easing: 'linear',
        fill: 'forwards',
      });

      try {
        await loadingAnimation.finished;
      } catch {
        return;
      }
      if (cancelled) return;

      const appShell = appShellRef.current;
      const headerLogo = appShell?.querySelector<HTMLImageElement>(
        '[data-nebula-logo="header"]',
      );
      const flyingLogo = logoRef.current;
      const visual = visualRef.current;
      if (!appShell || !headerLogo || !flyingLogo || !visual) {
        startReveal({ x: window.innerWidth / 2, y: window.innerHeight / 2 }, true);
        return;
      }

      await Promise.all([
        document.fonts.ready,
        decodeImage(headerLogo),
        decodeImage(flyingLogo),
      ]);
      if (cancelled) return;

      const appBounds = appShell.getBoundingClientRect();
      const first = flyingLogo.getBoundingClientRect();
      const last = headerLogo.getBoundingClientRect();
      const origin = {
        x: last.left + last.width / 2 - appBounds.left,
        y: last.top + last.height / 2 - appBounds.top,
      };
      const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

      if (reducedMotion || first.width === 0 || last.width === 0) {
        startReveal(origin, true);
        return;
      }

      const landingWidth = last.width * SPLASH_TIMING.appStartScale;
      const landingHeight = last.height * SPLASH_TIMING.appStartScale;
      const landingLeft = last.left + (last.width - landingWidth) / 2;
      const landingTop = last.top + (last.height - landingHeight) / 2;
      const translateX = landingLeft - first.left;
      const translateY = landingTop - first.top;
      const scaleX = landingWidth / first.width;
      const scaleY = landingHeight / first.height;
      const landingTransform = `translate(${translateX}px, ${translateY}px) scale(${scaleX}, ${scaleY})`;

      onPhaseChange('travel');
      const contentFade = animate(visual, [{ opacity: 1 }, { opacity: 0 }], {
        duration: SPLASH_TIMING.contentFadeMs,
        easing: 'ease-out',
        fill: 'forwards',
      });
      const logoTravel = animate(flyingLogo, [
        { transform: 'translate(0px, 0px) scale(1, 1)', opacity: 1 },
        { transform: landingTransform, opacity: 1 },
      ], {
        duration: SPLASH_TIMING.logoTravelMs,
        easing: SPLASH_TIMING.travelEasing,
        fill: 'forwards',
      });

      try {
        await Promise.all([contentFade.finished, logoTravel.finished]);
      } catch {
        return;
      }
      if (cancelled) return;

      flyingLogo.style.transform = landingTransform;
      logoTravel.cancel();
      startReveal(origin, false, true);
      window.requestAnimationFrame(() => {
        if (!cancelled) flyingLogo.style.opacity = '0';
      });
    };

    void run().catch(() => {
      if (!cancelled) {
        startReveal({ x: window.innerWidth / 2, y: window.innerHeight / 2 }, true);
      }
    });

    return () => {
      cancelled = true;
      animations.forEach((animation) => animation.cancel());
    };
  }, [appShellRef, assetsReady, onPhaseChange]);

  return (
    <>
      <link rel="preload" as="image" href={splashImage} />
      <div className="splash-overlay" role="status" aria-live="polite">
        <span className="splash-visually-hidden">Loading Nebula</span>
        <div className="splash-visual" ref={visualRef}>
          <img
            className="splash-background"
            src={splashImage}
            alt=""
            aria-hidden="true"
            ref={backgroundRef}
            loading="eager"
            fetchPriority="high"
            draggable={false}
          />
          <div className="splash-loader-track" aria-hidden="true">
            <div className="splash-loader-fill" ref={loaderRef} />
          </div>
        </div>
        <NebulaLogo
          className="splash-flight-logo"
          alt=""
          aria-hidden="true"
          data-splash-logo="true"
          ref={logoRef}
        />
      </div>
    </>
  );
}

function decodeImage(image: HTMLImageElement | null): Promise<void> {
  if (!image) return Promise.resolve();
  if (image.decode) return image.decode().then(() => undefined).catch(() => undefined);
  if (image.complete) return Promise.resolve();
  return new Promise((resolve) => {
    image.addEventListener('load', () => resolve(), { once: true });
    image.addEventListener('error', () => resolve(), { once: true });
  });
}

export default SplashScreen;
