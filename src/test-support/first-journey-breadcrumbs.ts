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
  'founder member grant selectors ready',
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
  'founder team page requested',
  'founder team creation submitted',
  'founder team created',
  'founder team detail page opened',
  'founder team role grant submitted',
  'founder team role grant accepted',
  'contributor team assignment submitted',
  'contributor team assignment accepted',
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

export interface JourneyBreadcrumb {
  step: JourneyStepName;
  path: string;
  visibleText: string[];
}

const approvedSteps = new Set<string>([
  ...journeyParticipants.flatMap((participant) =>
    participantStepSuffixes.map((suffix) => `${participant} ${suffix}`)
  ),
  ...journeyStepNames,
]);

const approvedVisibleText = [
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
  'Teams',
  'New team',
  'Create team',
  'Roles granted to this team',
  'Add a member',
  'Granted Contributor to this team.',
  'No active members are available to add.',
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
] as const;

export function createJourneyBreadcrumb(
  step: JourneyStepName,
  href: string,
  visibleText: readonly string[]
): JourneyBreadcrumb {
  if (!approvedSteps.has(step)) {
    throw new Error('The first-journey step name is not approved for logging.');
  }
  const candidates = visibleText.map((text) => text.trim());
  return {
    step,
    path: new URL(href).pathname,
    visibleText: approvedVisibleText.filter((approved) =>
      candidates.some(
        (candidate) => candidate === approved || candidate.includes(approved)
      )
    ),
  };
}
