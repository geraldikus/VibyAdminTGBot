import { useEffect, useMemo, useState } from 'react';
import type { AppSettings, EditableSettingKey } from '@school/shared';
import { EDITABLE_SETTING_LIMITS } from '@school/shared';
import { api } from '../api';
import { notifyError, notifySuccess } from '../feedback';
import { Cell, ErrorBox, IconTile, PageHeader, Section, SkeletonList, useMainButton, type IconName } from '../ui';

type Field = { key: EditableSettingKey; title: string; hint: string; unit: string; offAtZero?: boolean };
type Group = { title: string; icon: IconName; color: string; footer?: string; fields: Field[] };

const GROUPS: Group[] = [
  {
    title: 'Payments',
    icon: 'wallet',
    color: 'var(--c-yellow)',
    footer: 'You get a “Check payment” message at 10:00 for students in “Waiting for payment”. It repeats with the same interval until you change the status. 0 turns it off.',
    fields: [
      { key: 'payment_reminder_days', title: 'Payment reminder', hint: 'After days of waiting', unit: 'days', offAtZero: true },
    ],
  },
  {
    title: 'Lessons',
    icon: 'lessons',
    color: 'var(--c-blue)',
    fields: [
      { key: 'backdate_days', title: 'Mark lessons back', hint: 'Days in the past', unit: 'days' },
      { key: 'edit_window_min', title: 'Edit window', hint: 'To edit or cancel', unit: 'min' },
    ],
  },
  {
    title: 'Photos',
    icon: 'camera',
    color: 'var(--c-orange)',
    fields: [
      { key: 'photo_reminder_min', title: 'Remind teacher', hint: 'If no photo yet', unit: 'min' },
      { key: 'photo_admin_alert_min', title: 'Alert admin', hint: 'If still no photo', unit: 'min' },
    ],
  },
];

const KEYS = GROUPS.flatMap((g) => g.fields.map((f) => f.key));

function fieldError(key: EditableSettingKey, raw: string): string {
  const { min, max } = EDITABLE_SETTING_LIMITS[key];
  if (!/^\d+$/.test(raw.trim())) return `Whole number from ${min} to ${max}`;
  const n = Number(raw);
  return n < min || n > max ? `From ${min} to ${max}` : '';
}

export function AdminSettings({ onSaved }: { onSaved?: (settings: AppSettings) => void }) {
  const [saved, setSaved] = useState<AppSettings | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [channel, setChannel] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  function fill(settings: AppSettings) {
    setSaved(settings);
    setForm(Object.fromEntries(KEYS.map((k) => [k, String(settings[k])])));
  }

  useEffect(() => {
    api.get<{ settings: AppSettings; photo_channel_id: string }>('/api/admin/settings')
      .then((d) => { fill(d.settings); setChannel(d.photo_channel_id); })
      .catch((e: Error) => setError(e.message));
  }, []);

  const errors = useMemo(
    () => Object.fromEntries(KEYS.map((k) => [k, form[k] === undefined ? '' : fieldError(k, form[k])])),
    [form],
  );
  const changed = saved ? KEYS.filter((k) => form[k] !== undefined && form[k].trim() !== String(saved[k])) : [];
  const valid = KEYS.every((k) => !errors[k]);

  async function save() {
    if (busy || !changed.length || !valid) return;
    setBusy(true);
    try {
      const body = Object.fromEntries(changed.map((k) => [k, Number(form[k])]));
      const res = await api.patch<{ settings: AppSettings }>('/api/admin/settings', body);
      fill(res.settings);
      onSaved?.(res.settings);
      notifySuccess('Settings saved');
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Failed';
      setError(message);
      notifyError(message);
    } finally {
      setBusy(false);
    }
  }

  const native = useMainButton(busy ? 'Saving…' : 'Save', () => void save(), {
    visible: changed.length > 0,
    disabled: busy || !valid,
    progress: busy,
  });

  if (!saved) return error ? <ErrorBox error={error} /> : <SkeletonList rows={5} avatar={false} />;

  return (
    <>
      <PageHeader title="Settings" />
      <ErrorBox error={error} />
      {GROUPS.map((group) => (
        <Section key={group.title} title={group.title} footer={group.footer}>
          {group.fields.map((f) => {
            const value = form[f.key] ?? '';
            const err = errors[f.key];
            const off = f.offAtZero && value.trim() === '0';
            return (
              <Cell
                key={f.key}
                before={<IconTile name={group.icon} color={group.color} />}
                title={f.title}
                subtitle={err
                  ? <span style={{ color: 'var(--destructive)' }}>{err}</span>
                  : off ? 'Off' : f.hint}
                after={(
                  <span className="setting-value">
                    <input
                      inputMode="numeric"
                      aria-label={f.title}
                      value={value}
                      className={err ? 'invalid' : ''}
                      onChange={(e) => setForm({ ...form, [f.key]: e.target.value.replace(/[^\d]/g, '') })}
                    />
                    <span className="setting-unit">{f.unit}</span>
                  </span>
                )}
              />
            );
          })}
        </Section>
      ))}

      <Section title="Photo channel" footer="Change it with /setchannel in the chat with the bot: the bot checks it has access to the channel.">
        <Cell title="Channel ID" after={<span className="num">{channel || 'Not set'}</span>} />
      </Section>

      {!native && (
        <button className="btn mt" disabled={busy || !changed.length || !valid} onClick={() => void save()}>
          {busy ? 'Saving…' : 'Save'}
        </button>
      )}
    </>
  );
}
