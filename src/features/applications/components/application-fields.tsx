import { resource } from '@askrjs/askr/resources';

import { listPeople, type Person } from '../../workforce/workforce.js';
import type { ApplicationContent,
  ApplicationDeclarationContent,
} from '../applications.js';

export const emptyContent: ApplicationContent = {
  name: '',
  purpose: '',
  ownerReference: null,
  classification: null,
  systemOwnerPersonId: null,
  accessOwnerPersonId: null,
};

function blankToNull(value: string | null): string | null {
  return value !== null && value.trim() !== '' ? value.trim() : null;
}

export function cleanContent(content: ApplicationContent): ApplicationContent {
  return {
    name: content.name.trim(),
    purpose: content.purpose.trim(),
    ownerReference: blankToNull(content.ownerReference),
    classification: blankToNull(content.classification),
    systemOwnerPersonId: blankToNull(content.systemOwnerPersonId),
    accessOwnerPersonId: blankToNull(content.accessOwnerPersonId),
  };
}

export function cleanDeclaration(
  content: ApplicationDeclarationContent
): ApplicationDeclarationContent {
  return {
    ...cleanContent(content),
    applicationKind: content.applicationKind.trim(),
    criticality: content.criticality.trim(),
  };
}

export function declarationProblem(
  content: ApplicationDeclarationContent
): string | null {
  for (const [label, value, limit, required] of [
    ['Application name', content.name, 200, true],
    ['Purpose', content.purpose, 2000, true],
    ['Owner', content.ownerReference, 2000, false],
    ['Data classification', content.classification, 200, true],
    ['Application kind', content.applicationKind, 200, true],
    ['Criticality', content.criticality, 200, true],
  ] as const) {
    if (required && !value?.trim()) return `${label} is required.`;
    if ((value?.trim().length ?? 0) > limit)
      return `${label} must be ${limit} characters or fewer.`;
  }
  if (!content.systemOwnerPersonId)
    return 'Choose a system owner from the workforce roster.';
  if (!content.accessOwnerPersonId)
    return 'Choose an access owner from the workforce roster.';
  return null;
}

type TextKey = 'name' | 'purpose' | 'ownerReference' | 'classification';

type PersonKey = 'systemOwnerPersonId' | 'accessOwnerPersonId';

const textFields: { key: TextKey; label: string; required: boolean; hint?: string }[] = [
  { key: 'name', label: 'Application name', required: true },
  { key: 'purpose', label: 'Purpose', required: true },
  { key: 'ownerReference', label: 'Owner', required: false, hint: 'A person or team; leave blank if unknown.' },
  { key: 'classification', label: 'Data classification', required: false, hint: 'For example confidential or internal.' },
];

const personFields: { key: PersonKey; label: string; hint: string }[] = [
  { key: 'systemOwnerPersonId', label: 'System owner', hint: 'Accountable for the application on the workforce roster.' },
  { key: 'accessOwnerPersonId', label: 'Access owner', hint: 'Approves who may access the application.' },
];

// Chooses an owner from the workforce roster. A saved owner who is no longer listed stays selectable
// so an unrelated edit never clears it silently.

function PersonPicker({
  label,
  hint,
  value,
  people,
  unavailable,
  declaration,
  onChange,
}: {
  label: string;
  hint: string;
  value: string | null;
  people: Person[];
  unavailable: boolean;
  declaration: boolean;
  onChange: (next: string | null) => void;
}) {
  const known = value === null || people.some((person) => person.personId === value);
  return (
    <label className="registration-field">
      <span>{label}</span>
      <select value={value ?? ''}
        required={declaration}
        disabled={declaration && unavailable}
        onChange={(event: Event) => {
          const next = (event.target as HTMLSelectElement).value || null;
          if (
            !declaration ||
            (!unavailable &&
              (next === null ||
                people.some((person) => person.personId === next)))
          )
            onChange(next);
        }}>
        <option value="">Not assigned</option>
        {known ? null : (
          <option value={value!}>Person not on the roster</option>
        )}
        {people.map((person) => (
          <option value={person.personId}>
            {person.displayName}
            {person.workEmail ? ` (${person.workEmail})` : ''}
          </option>
        ))}
      </select>
      <small>{unavailable ? 'The workforce roster could not be loaded; owners cannot be changed right now.' : hint}</small>
    </label>
  );
}

export function ApplicationFields<
  T extends ApplicationContent & {
    applicationKind?: string;
    criticality?: string;
  },
>({
  content,
  onChange,
  mode,
}: {
  content: T;
  onChange: (next: T) => void;
  mode?: 'declaration';
}) {
  const people = resource(() => listPeople(), []);
  const roster = [...(people.value ?? [])].sort((a, b) => a.displayName.localeCompare(b.displayName));
  return (
    <>
      {textFields.map((field) => (
        <label className="registration-field">
          <span>{field.label}</span>
          <input
            type="text"
            value={content[field.key] ?? ''}
            onInput={(event: Event) => onChange({ ...content, [field.key]: (event.target as HTMLInputElement).value,
              })}
            required={field.required ||
              (mode === 'declaration' && field.key === 'classification')
            }
            maxLength={
              mode === 'declaration'
                ? field.key === 'name' || field.key === 'classification'
                  ? 200
                  : 2000
                : undefined
            }
          />
          {field.hint ? <small>{field.hint}</small> : null}
        </label>
      ))}
      {mode === 'declaration'
        ? (['applicationKind', 'criticality'] as const).map((key) => (
            <label className="registration-field">
              <span>
                {key === 'applicationKind' ? 'Application kind' : 'Criticality'}
              </span>
              <input
                type="text"
                value={content[key] ?? ''}
                onInput={(event: Event) =>
                  onChange({
                    ...content,
                    [key]: (event.target as HTMLInputElement).value,
                  })
                }
                required
                maxLength={200}
              />
            </label>
          ))
        : null}
      {personFields.map((field) => (
        <PersonPicker
          label={field.label}
          hint={field.hint}
          value={content[field.key]}
          people={roster}
          unavailable={people.error !== null && people.error !== undefined}
          declaration={mode === 'declaration'}
          onChange={(next) => onChange({ ...content, [field.key]: next })}
        />
      ))}
    </>
  );
}
