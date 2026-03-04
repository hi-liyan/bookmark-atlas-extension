const PROTOCOL_PREFIX = /^https?:\/\//i;
const TRAILING_SLASH = /\/+$/;

export const normalizeText = (value: string): string => value.trim().toLowerCase();

export const normalizeUrl = (value: string | undefined): string => {
  if (!value) {
    return '';
  }

  return value.trim().toLowerCase().replace(PROTOCOL_PREFIX, '').replace(TRAILING_SLASH, '');
};
