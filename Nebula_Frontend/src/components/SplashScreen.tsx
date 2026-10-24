import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import './SplashScreen.css';
import splashImage from '../assets/Nebula-splash.jpeg';

const IMAGE_LOAD_SAFETY_MS = 3000;
const FADE_OUT_MS = 500;

type SplashPhase = 'waiting' | 'loading' | 'fading' | 'done';

type SplashScreenProps = {
  durationMs?: number;
  onDone: () => void;
};

export function SplashScreen({ durationMs = 2000, onDone }: SplashScreenProps) {
  const [phase, setPhase] = useState<SplashPhase>('waiting');
  const [imageFailed, setImageFailed] = useState(false);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(() =>
    window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  const hasStartedRef = useRef(false);
  const hasFinishedRef = useRef(false);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  const safeDurationMs = Number.isFinite(durationMs)
    ? Math.max(0, durationMs)
    : 2000;
  const effectiveDurationMs = prefersReducedMotion
    ? Math.min(300, safeDurationMs)
    : safeDurationMs;

  const startLoading = useCallback(() => {
    if (hasStartedRef.current || hasFinishedRef.current) return;

    hasStartedRef.current = true;
    setPhase('loading');
  }, []);

  const finish = useCallback(() => {
    if (hasFinishedRef.current) return;

    hasFinishedRef.current = true;
    setPhase('done');
    onDoneRef.current();
  }, []);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const updateMotionPreference = () => {
      setPrefersReducedMotion(mediaQuery.matches);
    };

    updateMotionPreference();
    mediaQuery.addEventListener('change', updateMotionPreference);
    return () => mediaQuery.removeEventListener('change', updateMotionPreference);
  }, []);

  useEffect(() => {
    if (phase !== 'waiting') return;

    const safetyTimeout = window.setTimeout(() => {
      if (hasStartedRef.current) return;
      setImageFailed(true);
      startLoading();
    }, IMAGE_LOAD_SAFETY_MS);

    return () => window.clearTimeout(safetyTimeout);
  }, [phase, startLoading]);

  useEffect(() => {
    if (phase !== 'loading') return;

    const loadingTimeout = window.setTimeout(
      () => setPhase('fading'),
      effectiveDurationMs,
    );
    return () => window.clearTimeout(loadingTimeout);
  }, [effectiveDurationMs, phase]);

  useEffect(() => {
    if (phase !== 'fading') return;

    const fadeFallback = window.setTimeout(finish, FADE_OUT_MS + 100);
    return () => window.clearTimeout(fadeFallback);
  }, [finish, phase]);

  if (phase === 'done') return null;

  const overlayClasses = [
    'splash-overlay',
    phase === 'fading' ? 'splash-overlay--fading' : '',
    prefersReducedMotion ? 'splash-overlay--reduced-motion' : '',
  ]
    .filter(Boolean)
    .join(' ');
  const loaderFillClasses = [
    'splash-loader-fill',
    phase === 'waiting' ? '' : 'splash-loader-fill--running',
  ]
    .filter(Boolean)
    .join(' ');
  const loaderStyle = {
    '--splash-fill-duration': `${effectiveDurationMs}ms`,
  } as CSSProperties;

  return (
    <>
      <link rel="preload" as="image" href={splashImage} />
      <div
        className={overlayClasses}
        onTransitionEnd={(event) => {
          if (event.propertyName === 'opacity' && phase === 'fading') finish();
        }}
        role="status"
        aria-live="polite"
      >
        <span className="splash-visually-hidden">Loading Nebula</span>
        <div className="splash-content">
          {imageFailed ? (
            <span className="splash-fallback-title">Nebula</span>
          ) : (
            <img
              className="splash-logo"
              src={splashImage}
              alt="Nebula, mapping the constellations of your codebase"
              loading="eager"
              fetchPriority="high"
              onLoad={startLoading}
              onError={() => {
                setImageFailed(true);
                startLoading();
              }}
            />
          )}
          <div
            className="splash-loader-track"
            style={loaderStyle}
            aria-hidden="true"
          >
            <div className={loaderFillClasses} />
          </div>
        </div>
      </div>
    </>
  );
}

export default SplashScreen;
