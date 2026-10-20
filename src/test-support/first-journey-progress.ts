export const journeyParticipants = [
  'founder',
  'second administrator',
  'contributor',
] as const;

const participantStepSuffixes = [
  'login page requested',
  'login page opened',
  'login submitted',
  'login accepted',
  'verification form requested',
  'verification form opened',
  'verification challenge submitted',
  'verification challenge accepted; waiting for delivery',
  'verification challenge delivered',
  'email verification submitted',
  'email verification accepted',
  'organization access refresh submitted',
  'organization selector refreshed',
  'member roster requested',
  'member roster refreshed',
  'member access page requested',
  'member access loaded',
  'invitation submitted',
  'invitation accepted; waiting for delivery',
  'invitation delivered',
  'invitation acceptance form requested',
  'invitation acceptance form opened',
  'invitation acceptance submitted',
  'invitation acceptance received',
  'organization opened',
] as const;

const journeyStepNames = [
  'founder organization creation form requested',
  'founder organization creation submitted',
  'founder organization creation form opened',
  'founder organization name fill started',
  'founder organization name fill completed',
  'founder organization name fill failed',
  'founder organization legal name fill started',
  'founder organization legal name fill completed',
  'founder organization legal name fill failed',
  'founder organization slug fill started',
  'founder organization slug fill completed',
  'founder organization slug fill failed',
  'founder organization form state check started',
  'founder organization form state checked',
  'founder organization form state check failed',
  'founder organization creation button click started',
  'founder organization creation button click failed',
  'founder organization registration response received',
  'founder organization registration response timed out',
  'founder organization created',
  'founder organization page opened',
  'founder organization provisioning check started',
  'founder organization provisioning status checked',
  'founder organization administrator grant submitted',
  'founder organization administrator grant accepted',
  'founder organization administrator grant projection refresh started',
  'founder organization administrator grant projected',
  'second administrator invitation submitted',
  'contributor invitation submitted',
  'program creation submitted',
  'program creation form requested',
  'program creation form opened',
  'program created',
  'contributor pregrant access checked',
  'program role grant submitted',
  'program role grant accepted',
  'contributor program access checked',
  'boundary draft creation submitted',
  'boundary draft form requested',
  'boundary draft form opened',
  'boundary draft created',
  'founder responsibility conflict check submitted',
  'founder responsibility conflict check accepted',
  'founder separation of duties check submitted',
  'founder responsibility assignment submitted',
  'founder responsibility assignment accepted',
  'separation of duties denial observed',
  'founder suspension submitted',
  'founder member suspension page requested',
  'founder suspension accepted',
  'orphaned work displayed',
  'founder program access checked after suspension',
  'suspended founder program page requested',
  'second administrator organization page requested',
  'second administrator organization access checked',
  'reassignment draft page requested',
  'reassignment draft opened',
  'second administrator responsibility conflict check submitted',
  'second administrator responsibility conflict check accepted',
  'responsibility reassignment submitted',
  'responsibility reassignment accepted',
  'founder responsibility revocation submitted',
  'founder responsibility revocation accepted',
  'founder open responsibilities checked',
  'second administrator responsibility checked',
] as const;

export type JourneyParticipant = (typeof journeyParticipants)[number];
export type JourneyStepName =
  | `${JourneyParticipant} ${(typeof participantStepSuffixes)[number]}`
  | (typeof journeyStepNames)[number];

export type JourneyProgressEvent = {
  step: JourneyStepName;
  path: string;
  visibleText: string[];
  readinessRequests?: JourneyReadinessApiRequestState[];
  formValid?: boolean;
  createButtonEnabled?: boolean;
  createButtonType?: 'submit' | 'button' | 'reset' | 'other';
  registrationRouteFired?: boolean;
  registrationStatus?: number | null;
};

export type JourneyReadinessApiEndpoint =
  | 'tenant-slug-resolution'
  | 'tenant-provisioning-status'
  | 'tenant-memberships'
  | 'tenant-workspace';

export type JourneyReadinessApiResponse = {
  endpoint: JourneyReadinessApiEndpoint;
  status: number;
};

export type JourneyReadinessApiEvent =
  | {
      endpoint: JourneyReadinessApiEndpoint;
      kind: 'started' | 'finished' | 'failed';
    }
  | { endpoint: JourneyReadinessApiEndpoint; kind: 'response'; status: number };

export type JourneyReadinessApiRequestState = {
  endpoint: JourneyReadinessApiEndpoint;
  started: number;
  responseStatuses: number[];
  finished: number;
  failed: number;
  inFlight: number;
};

export type JourneyProgressDiagnostics = {
  readinessRequests?: readonly JourneyReadinessApiRequestState[];
  formValid?: boolean;
  createButtonEnabled?: boolean;
  createButtonType?: 'submit' | 'button' | 'reset' | 'other';
  registrationRouteFired?: boolean;
  registrationStatus?: number | null;
};

const approvedSteps = new Set<string>([
  ...journeyParticipants.flatMap((participant) =>
    participantStepSuffixes.map((suffix) => `${participant} ${suffix}`)
  ),
  ...journeyStepNames,
]);

const approvedVisibleText = new Set([
  'No organization access yet',
  'Your email address is verified.',
  'Create a new organization',
  'Create organization',
  'Creating your organization…',
  'Your organization has been created. Checking that your workspace is ready…',
  'Your organization has been created and is still getting ready. Check status in a moment.',
  'Your organization has been created. Your workspace readiness still needs confirmation.',
  'Your organization has been created, but we could not confirm its address. Please contact support.',
  'Your organization has been created, but we could not confirm it is ready yet. Check status to try again.',
  'Your organization address could not be reserved.',
  'Your organization is ready. Opening your workspace…',
  'Programs are not available to you',
  'Members',
  'Effective permissions',
  'Granted Org Admin on Whole organization.',
  'Your invitation acceptance was received.',
  'No separation-of-duties conflicts for this assignment.',
  'Separation-of-duties conflict',
  'Member suspended. Their access has ended.',
  'Open work needing reassignment',
  'Organization unavailable',
  'Responsibility assigned.',
  'Responsibility revoked.',
  'No open responsibilities.',
]);

export function createJourneyProgressEvent(
  step: JourneyStepName,
  href: string,
  visibleText: readonly string[],
  diagnostics: JourneyProgressDiagnostics = {}
): JourneyProgressEvent {
  if (!approvedSteps.has(step)) {
    throw new Error('The first-journey step name is not approved for logging.');
  }
  const candidates = visibleText.map((text) => text.trim());
  const safeText = [...approvedVisibleText].filter((approved) =>
    candidates.some(
      (candidate) => candidate === approved || candidate.includes(approved)
    )
  );
  const event: JourneyProgressEvent = {
    step,
    path: new URL(href).pathname,
    visibleText: safeText,
  };

  if (diagnostics.readinessRequests?.length) {
    event.readinessRequests = diagnostics.readinessRequests.flatMap(
      (request) => {
        if (
          !isReadinessApiEndpoint(request.endpoint) ||
          !isNonnegativeInteger(request.started) ||
          !isNonnegativeInteger(request.finished) ||
          !isNonnegativeInteger(request.failed)
        ) {
          return [];
        }
        const responseStatuses = request.responseStatuses.filter(isHttpStatus);
        return [
          {
            endpoint: request.endpoint,
            started: request.started,
            responseStatuses,
            finished: request.finished,
            failed: request.failed,
            inFlight: Math.max(
              0,
              request.started - request.finished - request.failed
            ),
          },
        ];
      }
    );
  }

  if (typeof diagnostics.formValid === 'boolean') {
    event.formValid = diagnostics.formValid;
  }
  if (typeof diagnostics.createButtonEnabled === 'boolean') {
    event.createButtonEnabled = diagnostics.createButtonEnabled;
  }
  if (
    diagnostics.createButtonType === 'submit' ||
    diagnostics.createButtonType === 'button' ||
    diagnostics.createButtonType === 'reset' ||
    diagnostics.createButtonType === 'other'
  ) {
    event.createButtonType = diagnostics.createButtonType;
  }
  if (typeof diagnostics.registrationRouteFired === 'boolean') {
    event.registrationRouteFired = diagnostics.registrationRouteFired;
  }
  if (
    diagnostics.registrationStatus === null ||
    (typeof diagnostics.registrationStatus === 'number' &&
      Number.isInteger(diagnostics.registrationStatus) &&
      diagnostics.registrationStatus >= 100 &&
      diagnostics.registrationStatus <= 599)
  ) {
    event.registrationStatus = diagnostics.registrationStatus;
  }

  return event;
}

export function summarizeTenantReadinessResponse(
  href: string,
  status: number
): JourneyReadinessApiResponse | null {
  const endpoint = summarizeTenantReadinessEndpoint(href);
  return endpoint && isHttpStatus(status) ? { endpoint, status } : null;
}

export function summarizeTenantReadinessEndpoint(
  href: string
): JourneyReadinessApiEndpoint | null {
  let pathname: string;
  try {
    pathname = new URL(href).pathname;
  } catch {
    return null;
  }

  return /^\/api\/v1\/tenant-slugs\/[^/]+\/mine$/.test(pathname)
    ? 'tenant-slug-resolution'
    : /^\/api\/v1\/tenants\/[^/]+\/provisioning-status$/.test(pathname)
      ? 'tenant-provisioning-status'
      : pathname === '/api/v1/tenants/mine'
        ? 'tenant-memberships'
        : /^\/api\/v1\/tenants\/[^/]+$/.test(pathname)
          ? 'tenant-workspace'
          : null;
}

export function summarizeTenantReadinessEvents(
  events: readonly JourneyReadinessApiEvent[]
): JourneyReadinessApiRequestState[] {
  const states = new Map<
    JourneyReadinessApiEndpoint,
    Omit<JourneyReadinessApiRequestState, 'inFlight'>
  >();

  for (const event of events) {
    if (!isReadinessApiEndpoint(event.endpoint)) continue;
    let state = states.get(event.endpoint);
    if (!state) {
      state = {
        endpoint: event.endpoint,
        started: 0,
        responseStatuses: [],
        finished: 0,
        failed: 0,
      };
      states.set(event.endpoint, state);
    }
    if (event.kind === 'started') state.started += 1;
    else if (event.kind === 'finished') state.finished += 1;
    else if (event.kind === 'failed') state.failed += 1;
    else if (event.kind === 'response' && isHttpStatus(event.status)) {
      state.responseStatuses.push(event.status);
    }
  }

  return [...states.values()].map((state) => ({
    ...state,
    inFlight: Math.max(0, state.started - state.finished - state.failed),
  }));
}

function isReadinessApiEndpoint(
  endpoint: string
): endpoint is JourneyReadinessApiEndpoint {
  return (
    endpoint === 'tenant-slug-resolution' ||
    endpoint === 'tenant-provisioning-status' ||
    endpoint === 'tenant-memberships' ||
    endpoint === 'tenant-workspace'
  );
}

function isHttpStatus(status: number): boolean {
  return Number.isInteger(status) && status >= 100 && status <= 599;
}

function isNonnegativeInteger(value: number): boolean {
  return Number.isInteger(value) && value >= 0;
}
