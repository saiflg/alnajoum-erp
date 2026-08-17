import Image from 'next/image';

/**
 * The real Alnajoum Travel Agency logo mark (the red star + blue swoosh,
 * cropped from the agency's own lockup — see apps/web/public/brand). Used
 * everywhere the old "AT" letter badge used to be: the marketing header and
 * footer, and the login/register cards.
 */
export function BrandMark({ size = 36 }: { size?: number }) {
  return (
    <Image
      src="/brand/logo-mark.png"
      alt="Alnajoum Travel Agency"
      width={size}
      height={size}
      priority
      className="object-contain"
      style={{ width: size, height: size }}
    />
  );
}
