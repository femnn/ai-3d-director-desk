export interface PhonePreviewVersionState {
  revision: number;
  token: string;
}

export function shouldApplyPhonePreview(
  current: PhonePreviewVersionState,
  incomingToken: string | undefined,
  incomingRevision: number
) {
  if (incomingToken) return incomingToken !== current.token;
  if (current.token) return false;
  return incomingRevision > current.revision;
}

