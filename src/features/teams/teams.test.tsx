// @vitest-environment jsdom
import { render, type RenderResult } from '@askrjs/askr/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { accessibilityViolations } from '../../accessibility/axe.js';
import { stubApi } from '../../test-support/api-stub.js';
import { clearActiveTenant, resolveTenantRoute } from '../tenants/tenants.js';
import { TeamsListPage } from './pages/teams-list.js';
import { TeamDetailPage } from './pages/team-detail.js';

const tenantId = '0190a1b2-0000-7000-8000-000000000001';
let api: ReturnType<typeof stubApi>;
const mounted: RenderResult[] = [];

function holdApiPath(path: string): () => void {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const fetch = globalThis.fetch.bind(globalThis);
  vi.stubGlobal(
    'fetch',
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const href = input instanceof Request ? input.url : String(input);
      if (new URL(href, 'http://app.test').pathname === path) await gate;
      return fetch(input, init);
    }
  );
  return release;
}

beforeEach(async () => {
  clearActiveTenant();
  api = stubApi();
  api.reply('/api/v1/tenant-slugs/acme/mine', 200, {
    tenant_id: tenantId,
    current_slug: 'acme',
    redirect: false,
  });
  api.reply('/api/v1/tenants/mine', 200, {
    items: [{ tenant_id: tenantId, name: 'Acme Corp', slug: 'acme' }],
    next_cursor: null,
  });
  await resolveTenantRoute('acme', {
    pathname: '/acme/teams',
    search: '',
    hash: '',
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  while (mounted.length > 0) mounted.pop()?.cleanup();
});

describe('teams in an organization (R1-15 frontend #176)', () => {
  const rosterPath = `/api/v1/tenants/${tenantId}/members`;

  function teamAnswer() {
    const base = `/api/v1/tenants/${tenantId}`;
    api.reply(`${base}/teams/team-1`, 200, {
      team_id: 'team-1',
      name: 'Security',
    });
    api.reply(`${base}/teams/team-1/roles`, 200, {
      items: [],
      next_cursor: null,
    });
    api.reply(`${base}/roles`, 200, { items: [], next_cursor: null });
    return `${base}/teams/team-1/members`;
  }

  function mountDetail() {
    const result = render(() => <TeamDetailPage teamId="team-1" />);
    mounted.push(result);
    return result.container;
  }

  it('ShouldIdentifyTeamMembersGivenAuthorizedPresentation', async () => {
    // Arrange
    api.reply(teamAnswer(), 200, {
      items: [
        {
          team_id: 'team-1',
          member_id: 'member-1',
          user_id: 'user-1',
          display_name: 'Ada Lovelace',
          verified_email_address: 'ada@example.test',
        },
      ],
      next_cursor: null,
    });

    // Act
    const container = mountDetail();

    // Assert
    await vi.waitFor(() =>
      expect(container.textContent).toContain('Ada Lovelace')
    );
    expect(container.textContent).toContain('ada@example.test');
    expect(
      container.querySelector('a[href="/acme/members/user-1"]')?.textContent
    ).toBe('Ada Lovelace');
    expect(
      container.querySelector(
        'button[aria-label="Remove Ada Lovelace from this team"]'
      )
    ).not.toBeNull();
  });

  it('ShouldExplainEmptyPopulationGivenNoTeamMembers', async () => {
    // Arrange
    api.reply(teamAnswer(), 200, { items: [], next_cursor: null });

    // Act
    const container = mountDetail();

    // Assert
    await vi.waitFor(() =>
      expect(container.textContent).toContain(
        'No members belong to this team yet.'
      )
    );
  });

  it('ShouldRetryMemberProjectionConflictGivenRefresh', async () => {
    // Arrange
    const path = teamAnswer();
    api.reply(path, 409, {
      detail: 'The member projection has not reached the source.',
      status: 409,
    });
    const container = mountDetail();
    await vi.waitFor(() =>
      expect(container.textContent).toContain('The member projection')
    );
    api.reply(path, 200, {
      items: [
        {
          team_id: 'team-1',
          member_id: 'member-1',
          display_name: 'Ada Lovelace',
        },
      ],
      next_cursor: null,
    });

    // Act
    [...container.querySelectorAll('button')]
      .find((button) => button.textContent?.trim() === 'Try again')!
      .click();

    // Assert
    await vi.waitFor(() =>
      expect(container.textContent).toContain('Ada Lovelace')
    );
    expect(container.textContent).not.toContain('The member projection');
  });

  it('ShouldHideManagementGivenForbiddenMemberReads', async () => {
    // Arrange
    api.reply(teamAnswer(), 403, { detail: 'Forbidden', status: 403 });

    // Act
    const container = mountDetail();

    // Assert
    await vi.waitFor(() =>
      expect(container.textContent).toContain(
        'Team members are not available to you'
      )
    );
    expect(
      container.querySelector('input[placeholder="Member ID"]')
    ).toBeNull();
  });

  it('ShouldExcludeSuspendedAndFirmStaffFromTheAccessibleTeamPicker', async () => {
    // Arrange
    api.reply(teamAnswer(), 200, { items: [], next_cursor: null });
    api.reply(rosterPath, 200, {
      items: [
        {
          user_id: 'user-active',
          tenant_id: tenantId,
          affiliation: 'client_personnel',
          is_suspended: false,
          display_name: 'Ada Lovelace',
          verified_email_address: 'ada@example.test',
        },
        {
          user_id: 'user-suspended',
          tenant_id: tenantId,
          affiliation: 'client_personnel',
          is_suspended: true,
          display_name: 'Grace Hopper',
          verified_email_address: 'grace@example.test',
        },
        {
          user_id: 'user-firm-staff',
          tenant_id: tenantId,
          affiliation: 'firm_staff',
          is_suspended: false,
          display_name: 'Katherine Johnson',
          verified_email_address: 'katherine@example.test',
        },
      ],
      next_cursor: null,
    });

    // Act
    const container = mountDetail();

    // Assert
    await vi.waitFor(() =>
      expect(
        container.querySelector('select[aria-label="Member"]')
      ).not.toBeNull()
    );
    const memberPicker = container.querySelector(
      'select[aria-label="Member"]'
    ) as HTMLSelectElement;
    expect(memberPicker.labels[0]?.textContent?.trim()).toContain('Member');
    expect(
      [...memberPicker.options].map((option) => option.textContent)
    ).toEqual(['Choose a member', 'Ada Lovelace — ada@example.test']);
    expect(
      container.querySelector('input[placeholder="Member ID"]')
    ).toBeNull();
    expect(api.requested).toContain(rosterPath);
    expect(await accessibilityViolations(container)).toEqual([]);
  });

  it('ShouldExplainLoadingAndEmptyActiveMemberRoster', async () => {
    // Arrange
    api.reply(teamAnswer(), 200, { items: [], next_cursor: null });
    api.reply(rosterPath, 200, { items: [], next_cursor: null });
    const releaseRoster = holdApiPath(rosterPath);

    // Act
    const container = mountDetail();

    // Assert
    try {
      await vi.waitFor(() =>
        expect(
          container.querySelector('[aria-label="Loading members"]')
        ).not.toBeNull()
      );
    } finally {
      releaseRoster();
    }
    await vi.waitFor(() =>
      expect(container.textContent).toContain(
        'No active members are available to add.'
      )
    );
    expect(container.querySelector('button[type="submit"]')).toBeNull();
  });

  it('ShouldRetryMemberRosterFailure', async () => {
    // Arrange
    api.reply(teamAnswer(), 200, { items: [], next_cursor: null });
    api.reply(rosterPath, 500, {
      title: 'Roster unavailable',
      status: 500,
      detail: 'Member roster unavailable.',
    });
    const container = mountDetail();
    await vi.waitFor(() =>
      expect(container.querySelector('[role="alert"]')?.textContent).toContain(
        'Member roster unavailable.'
      )
    );
    api.reply(rosterPath, 200, {
      items: [
        {
          user_id: 'user-active',
          tenant_id: tenantId,
          affiliation: 'client_personnel',
          is_suspended: false,
          display_name: 'Ada Lovelace',
          verified_email_address: 'ada@example.test',
        },
      ],
      next_cursor: null,
    });

    // Act
    [...container.querySelectorAll('button')]
      .find((button) => button.textContent?.trim() === 'Try again')!
      .click();

    // Assert
    await vi.waitFor(() =>
      expect(
        container.querySelector('select[aria-label="Member"]')
      ).not.toBeNull()
    );
    expect(container.textContent).not.toContain('Member roster unavailable.');
  });

  it('ShouldResolveTheSelectedUserAndAssignItsMembershipId', async () => {
    // Arrange
    const membershipId = 'member-101';
    const userId = 'user-202';
    const base = `/api/v1/tenants/${tenantId}`;
    api.reply(teamAnswer(), 200, { items: [], next_cursor: null });
    api.reply(rosterPath, 200, {
      items: [
        {
          user_id: userId,
          tenant_id: tenantId,
          affiliation: 'client_personnel',
          is_suspended: false,
          display_name: 'Ada Lovelace',
          verified_email_address: 'ada@example.test',
        },
      ],
      next_cursor: null,
    });
    api.reply(`${base}/members/${userId}/access`, 200, {
      member_id: membershipId,
      paths: [],
      grant_paths: [],
      effective_permissions: [],
    });
    api.reply(`POST ${base}/teams/team-1/members/${membershipId}`, 204);
    const container = mountDetail();
    await vi.waitFor(() =>
      expect(
        container.querySelector('select[aria-label="Member"]')
      ).not.toBeNull()
    );

    // Act
    const memberPicker = container.querySelector(
      'select[aria-label="Member"]'
    ) as HTMLSelectElement;
    memberPicker.value = userId;
    memberPicker.dispatchEvent(new Event('change', { bubbles: true }));
    [...container.querySelectorAll('button')]
      .find((button) => button.textContent?.trim() === 'Add member')!
      .click();

    // Assert
    await vi.waitFor(() =>
      expect(
        api.requestUrls.some(
          ({ method, url }) =>
            method === 'POST' &&
            new URL(url).pathname ===
              `${base}/teams/team-1/members/${membershipId}`
        )
      ).toBe(true)
    );
    expect(
      api.requestUrls.some(
        ({ method, url }) =>
          method === 'GET' &&
          new URL(url).pathname === `${base}/members/${userId}/access`
      )
    ).toBe(true);
    expect(
      api.requestUrls.some(
        ({ method, url }) =>
          method === 'POST' &&
          new URL(url).pathname === `${base}/teams/team-1/members/${userId}`
      )
    ).toBe(false);
  });

  it('ShouldNotAssignWhenSelectedMemberAccessCannotBeRead', async () => {
    // Arrange
    const userId = 'user-202';
    const base = `/api/v1/tenants/${tenantId}`;
    api.reply(teamAnswer(), 200, { items: [], next_cursor: null });
    api.reply(rosterPath, 200, {
      items: [
        {
          user_id: userId,
          tenant_id: tenantId,
          affiliation: 'client_personnel',
          is_suspended: false,
          display_name: 'Ada Lovelace',
          verified_email_address: 'ada@example.test',
        },
      ],
      next_cursor: null,
    });
    api.reply(`${base}/members/${userId}/access`, 403, {
      type: 'https://example.test/forbidden',
      title: 'Forbidden',
      status: 403,
      detail: 'Forbidden',
      instance: '/members/access',
    });
    const container = mountDetail();
    await vi.waitFor(() =>
      expect(
        container.querySelector('select[aria-label="Member"]')
      ).not.toBeNull()
    );

    // Act
    const memberPicker = container.querySelector(
      'select[aria-label="Member"]'
    ) as HTMLSelectElement;
    memberPicker.value = userId;
    memberPicker.dispatchEvent(new Event('change', { bubbles: true }));
    [...container.querySelectorAll('button')]
      .find((button) => button.textContent?.trim() === 'Add member')!
      .click();

    // Assert
    await vi.waitFor(() =>
      expect(container.querySelector('[role="alert"]')?.textContent).toContain(
        "You do not have permission to load this member's access."
      )
    );
    expect(
      api.requestUrls.some(
        ({ method, url }) =>
          method === 'POST' &&
          new URL(url).pathname.startsWith(`${base}/teams/team-1/members/`)
      )
    ).toBe(false);
  });

  it('ShouldLoadTheOrganizationsTeamsOnceGivenARender', async () => {
    // Arrange
    const teamsPath = `/api/v1/tenants/${tenantId}/teams`;
    api.reply(teamsPath, 200, {
      items: [{ team_id: 'team-1', name: 'Security' }],
      next_cursor: null,
    });

    // Act
    const result = render(TeamsListPage as never);
    mounted.push(result);
    await vi.waitFor(() =>
      expect(result.container.textContent).toContain('Security')
    );
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Assert
    expect(api.requested.filter((path) => path === teamsPath)).toHaveLength(1);
    expect(
      result.container.querySelector('a[href="/acme/teams/team-1"]')
    ).not.toBeNull();
  });

  it('ShouldCreateATeamThroughAnAssociatedNameLabel', async () => {
    // Arrange
    const teamsPath = `/api/v1/tenants/${tenantId}/teams`;
    api.reply(teamsPath, 200, { items: [], next_cursor: null });
    api.reply(`POST ${teamsPath}/*`, 204);
    const result = render(TeamsListPage as never);
    mounted.push(result);
    const container = result.container;
    const input = container.querySelector(
      'input[placeholder="Team name"]'
    ) as HTMLInputElement;

    // Assert
    expect(input.labels?.[0]?.textContent?.trim()).toBe('Team name');
    expect(await accessibilityViolations(container)).toEqual([]);

    // Act
    input.value = 'Quality Reviewers';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    container
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    // Assert
    await vi.waitFor(() =>
      expect(
        api.requestUrls.some(
          ({ method, url }) =>
            method === 'POST' &&
            new URL(url).pathname.startsWith(`${teamsPath}/`)
        )
      ).toBe(true)
    );
  });
});
