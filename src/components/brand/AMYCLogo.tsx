import type { ImgHTMLAttributes } from 'react';

type AMYCLogoProps = Omit<ImgHTMLAttributes<HTMLImageElement>, 'src' | 'alt'> & {
  alt?: string;
};

export default function AMYCLogo({
  alt = 'AMYC Logo',
  className,
  ...props
}: AMYCLogoProps) {
  return (
    <img
      src="/logo-amyc.jpeg"
      alt={alt}
      className={className}
      decoding="async"
      draggable={false}
      {...props}
    />
  );
}
