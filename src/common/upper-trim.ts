import { Transform } from 'class-transformer';

/** Trims and uppercases a string (empty → null), e.g. for GSTIN and IFSC. */
export const UpperTrim = () =>
  Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() || null : value,
  );
