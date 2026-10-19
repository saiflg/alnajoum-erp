'use client';

import { useRef } from 'react';

/**
 * One button that opens the computer's file window and hands the chosen file to `onFile` straight away.
 * (A bare file input plus a separate "Upload" button looks like a broken button: Upload does nothing until
 * a file has been picked with the small "Browse…" control beside it.)
 */
export function FilePickButton({ label, accept, disabled, className, onFile }: {
  label: string;
  accept: string;
  disabled?: boolean;
  className?: string;
  onFile: (file: File) => void | Promise<void>;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={ref}
        type="file"
        accept={accept}
        className="hidden"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = ''; // so choosing the same file again still fires
          if (f) void onFile(f);
        }}
      />
      <button type="button" className={className} disabled={disabled} onClick={() => ref.current?.click()}>{label}</button>
    </>
  );
}
