import { forwardRef, type ImgHTMLAttributes } from 'react';

const NEBULA_LOGO_SRC = '/favicon.svg?v=2';

type NebulaLogoProps = Omit<ImgHTMLAttributes<HTMLImageElement>, 'src'>;

export const NebulaLogo = forwardRef<HTMLImageElement, NebulaLogoProps>(function NebulaLogo(props, ref) {
  return (
    <img
      {...props}
      ref={ref}
      src={NEBULA_LOGO_SRC}
      decoding="async"
      draggable={false}
    />
  );
});
